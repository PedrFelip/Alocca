import type { INestApplication } from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'
import { Test } from '@nestjs/testing'
import { drizzle } from 'drizzle-orm/postgres-js'
import { readFile, readdir } from 'node:fs/promises'
import postgres from 'postgres'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { createServer } from 'node:net'
import request from 'supertest'
import { AppModule } from '../src/app.module.ts'
import { criarClientePostgres } from '../src/db/cliente-postgres.ts'
import { DRIZZLE_DB } from '../src/db/db.provider.ts'
import { validateEnv } from '../src/config/env.ts'
import { RepositorioEntregas } from '../src/notificacoes/entrega/repositorio.ts'
import { WorkerNotificacoes } from '../src/notificacoes/entrega/worker.ts'
import { CanalSmtp } from '../src/notificacoes/entrega/smtp.ts'
import {
  FalhaEntrega,
  type CanalEntrega,
} from '../src/notificacoes/entrega/contrato.ts'

const adminUrl = process.env.NOTIFICATIONS_TEST_DATABASE_URL
const nome = `alocca_notificacoes_${process.pid}_${Date.now()}`
const url = new URL(
  adminUrl ??
    'postgresql://alocca_test:local-notifications-test@127.0.0.1:55439/postgres',
)
url.pathname = `/${nome}`
// Opt-in explícito: jamais usa DATABASE_URL de desenvolvimento/produção.
describe.skipIf(!adminUrl)(
  'Notificações: PostgreSQL real e SMTP Docker',
  () => {
    let admin: postgres.Sql
    let pg: postgres.Sql
    let app: INestApplication
    let repo: RepositorioEntregas
    let usuario: string
    let plantao: string
    let bearer: string
    const env = validateEnv({
      NODE_ENV: 'test',
      DATABASE_URL: url.toString(),
      JWT_SECRET: 'test-only-secret-with-at-least-32-characters',
      SMTP_HOST: '127.0.0.1',
      SMTP_PORT: 51025,
      SMTP_FROM: 'alocca@example.test',
    })
    beforeAll(async () => {
      admin = postgres(adminUrl!, { max: 1, connect_timeout: 3 })
      await admin.unsafe(`CREATE DATABASE ${nome}`)
      pg = criarClientePostgres(url.toString(), { max: 8 })
      for (const dir of (await readdir('drizzle')).sort())
        await pg.unsafe(await readFile(`drizzle/${dir}/migration.sql`, 'utf8'))
      const db = drizzle({ client: pg })
      repo = new RepositorioEntregas(db)
      const module = await Test.createTestingModule({ imports: [AppModule] })
        .overrideProvider(DRIZZLE_DB)
        .useValue(db)
        .compile()
      app = module.createNestApplication()
      await app.init()
    }, 60_000)
    afterAll(async () => {
      await app?.close()
      await pg?.end()
      if (admin) {
        await admin.unsafe(`DROP DATABASE IF EXISTS ${nome} WITH (FORCE)`)
        await admin.end()
      }
    })
    beforeEach(async () => {
      await pg`TRUNCATE usuarios CASCADE`
      const users =
        await pg`INSERT INTO usuarios (nome,email,senha_hash,tipo) VALUES
      ('Um','um@example.test','hash','MEDICO'), ('Dois','dois@example.test','hash','MEDICO') RETURNING id`
      usuario = users[0].id
      const [i] =
        await pg`INSERT INTO instituicoes (usuario_id,nome,cnpj,cidade,uf)
      VALUES (${usuario},'Hospital','11111111000111','Brasília','DF') RETURNING id`
      const [p] =
        await pg`INSERT INTO plantoes (instituicao_id,gestor_criador_id,titulo,local_unidade,especialidade,
      data_inicio,data_fim,valor,quantidade_vagas,vagas_disponiveis,status)
      VALUES (${i.id},${usuario},'Plantão','UTI','Clínica','2030-01-01','2030-01-02',100,1,1,'ABERTO') RETURNING id`
      plantao = p.id
      const jwt = app.get(JwtService)
      bearer = `Bearer ${await jwt.signAsync({ sub: usuario, jti: 'sessao-1' })}`
      await pg`INSERT INTO preferencias_notificacao (usuario_id,email,push) VALUES (${usuario},true,true)`
    })
    async function evento() {
      const [n] =
        await pg`INSERT INTO notificacoes (usuario_destino_id,plantao_id,tipo)
      VALUES (${usuario},${plantao},'ALOCACAO_APROVADA') RETURNING id`
      return n.id as string
    }
    it('rollback não produz entrega; expansão repetida é idempotente', async () => {
      await expect(
        pg.begin(async (tx) => {
          await tx`INSERT INTO notificacoes (usuario_destino_id,plantao_id,tipo) VALUES (${usuario},${plantao},'ALOCACAO_APROVADA')`
          throw new Error('rollback')
        }),
      ).rejects.toThrow('rollback')
      expect(await repo.expandir(100)).toBe(0)
      await evento()
      expect(await repo.expandir(100)).toBe(1)
      expect(await repo.expandir(100)).toBe(0)
      expect((await pg`SELECT * FROM entregas_notificacao`).length).toBe(1)
    })
    it('SKIP LOCKED não espera por evento reservado por outra conexão', async () => {
      const id = await evento()
      let liberar!: () => void
      let reservada!: () => void
      const pronta = new Promise<void>((r) => {
        reservada = r
      })
      const trava = new Promise<void>((r) => {
        liberar = r
      })
      const tx = pg.begin(async (sql) => {
        await sql`SELECT id FROM notificacoes WHERE id=${id} FOR UPDATE`
        reservada()
        await trava
      })
      await pronta
      try {
        expect(await repo.expandir(100)).toBe(0)
      } finally {
        liberar()
        await tx
      }
      expect(await repo.expandir(100)).toBe(1)
    })
    it('workers concorrentes reservam IDs distintos e lease vencido usa fencing', async () => {
      await Promise.all(Array.from({ length: 12 }, () => evento()))
      await Promise.all([repo.expandir(6), repo.expandir(6)])
      const lotes = await Promise.all([repo.reservar(6), repo.reservar(6)])
      expect(lotes.flat()).toHaveLength(12)
      expect(new Set(lotes.flat().map((e) => e.id)).size).toBe(12)
      const antiga = lotes[0][0]
      await pg`UPDATE entregas_notificacao SET lease_ate=now()-interval '1 second' WHERE id=${antiga.id}`
      const [nova] = await repo.reservar(1)
      expect(nova.id).toBe(antiga.id)
      expect(nova.lease_id).not.toBe(antiga.lease_id)
      expect(await repo.finalizar(antiga, 'ENVIADA', null)).toBe(false)
      expect(await repo.finalizar(nova, 'ENVIADA', null)).toBe(true)
    })
    it('falha temporária agenda retry; nova tentativa envia por SMTP real', async () => {
      const id = await evento()
      const temporario: CanalEntrega = {
        enviar: async () => {
          throw new FalhaEntrega('TESTE_TEMPORARIO')
        },
        fechar() {},
      }
      await new WorkerNotificacoes(
        repo,
        { email: temporario },
        2,
        () => {},
      ).ciclo()
      const [retry] =
        await pg`SELECT * FROM entregas_notificacao WHERE notificacao_id=${id}`
      expect(retry.estado).toBe('PENDENTE')
      expect(retry.tentativas).toBe(1)
      expect(new Date(retry.proxima_at).getTime()).toBeGreaterThan(Date.now())
      expect(await repo.reservar(1)).toHaveLength(0)
      await pg`UPDATE entregas_notificacao SET proxima_at=now() WHERE id=${retry.id}`
      const smtp = new CanalSmtp(env)
      try {
        await new WorkerNotificacoes(repo, { email: smtp }, 2, () => {}).ciclo()
      } finally {
        smtp.fechar()
      }
      const [enviada] =
        await pg`SELECT * FROM entregas_notificacao WHERE id=${retry.id}`
      expect(enviada.estado).toBe('ENVIADA')
      expect(enviada.tentativas).toBe(2)
      expect(
        (await pg`SELECT status FROM notificacoes WHERE id=${id}`)[0].status,
      ).toBe('ENVIADA')
      const resposta = await fetch('http://127.0.0.1:58025/api/v1/messages')
      expect(resposta.ok).toBe(true)
      const mensagens = (await resposta.json()) as {
        messages: { ID: string }[]
      }
      const corpos = await Promise.all(
        mensagens.messages.map(async (m) =>
          (await fetch(`http://127.0.0.1:58025/api/v1/message/${m.ID}`)).text(),
        ),
      )
      expect(corpos.some((c) => c.includes(id))).toBe(true)
    })
    it('preferência alterada antes do envio cancela entrega e SMTP ausente nunca vira enviada', async () => {
      const id = await evento()
      await repo.expandir(100)
      await pg`UPDATE preferencias_notificacao SET email=false WHERE usuario_id=${usuario}`
      await new WorkerNotificacoes(
        repo,
        {
          email: {
            enviar: async () => {
              throw new Error('Não deve enviar')
            },
            fechar() {},
          },
        },
        2,
        () => {},
      ).ciclo()
      expect(
        (
          await pg`SELECT estado FROM entregas_notificacao WHERE notificacao_id=${id}`
        )[0].estado,
      ).toBe('CANCELADA')
      await pg`UPDATE preferencias_notificacao SET email=true WHERE usuario_id=${usuario}`
      const novo = await evento()
      const smtp = new CanalSmtp({ ...env, SMTP_HOST: undefined })
      await new WorkerNotificacoes(repo, { email: smtp }, 2, () => {}).ciclo()
      expect(
        (
          await pg`SELECT estado FROM entregas_notificacao WHERE notificacao_id=${novo}`
        )[0].estado,
      ).toBe('BLOQUEADA')
      expect(
        (await pg`SELECT status FROM notificacoes WHERE id=${novo}`)[0].status,
      ).toBe('PENDENTE')
    })
    it('worker em processo separado entrega e encerra por SIGTERM', async () => {
      const id = await evento()
      const filho = spawn('bun', ['run', 'src/notificacoes/worker-main.ts'], {
        env: {
          ...process.env,
          DATABASE_URL: url.toString(),
          JWT_SECRET: env.JWT_SECRET,
          SMTP_HOST: '127.0.0.1',
          SMTP_PORT: '51025',
          SMTP_USER: '',
          SMTP_PASS: '',
          SMTP_FROM: 'qa@example.test',
          NOTIFICATIONS_POLL_MS: '250',
        },
        stdio: 'ignore',
      })
      const encerrado = once(filho, 'exit')
      try {
        await vi.waitFor(
          async () => {
            expect(
              (await pg`SELECT status FROM notificacoes WHERE id=${id}`)[0]
                .status,
            ).toBe('ENVIADA')
          },
          { timeout: 15_000, interval: 100 },
        )
      } finally {
        filho.kill('SIGTERM')
      }
      const [codigo] = await encerrado
      expect(codigo).toBe(0)
    }, 20_000)
    it('resposta SMTP 451 real é transitória e preserva entrega para retry', async () => {
      const servidor = createServer((socket) => {
        socket.write('220 localhost ESMTP teste\r\n')
        let buffer = ''
        socket.on('data', (chunk) => {
          buffer += chunk.toString()
          while (buffer.includes('\r\n')) {
            const fim = buffer.indexOf('\r\n')
            const comando = buffer.slice(0, fim).toUpperCase()
            buffer = buffer.slice(fim + 2)
            if (comando.startsWith('EHLO')) socket.write('250 localhost\r\n')
            else if (comando.startsWith('RCPT'))
              socket.write('451 Tente novamente\r\n')
            else if (comando.startsWith('QUIT')) {
              socket.end('221 Fim\r\n')
            } else socket.write('250 OK\r\n')
          }
        })
      })
      servidor.listen(0, '127.0.0.1')
      await once(servidor, 'listening')
      const endereco = servidor.address() as { port: number }
      const smtp = new CanalSmtp({ ...env, SMTP_PORT: endereco.port })
      try {
        const id = await evento()
        await new WorkerNotificacoes(repo, { email: smtp }, 2, () => {}).ciclo()
        const [entrega] =
          await pg`SELECT estado, erro_codigo FROM entregas_notificacao WHERE notificacao_id=${id}`
        expect(entrega.estado).toBe('PENDENTE')
        expect(entrega.erro_codigo).toBe('SMTP_451')
      } finally {
        smtp.fechar()
        servidor.close()
        await once(servidor, 'close')
      }
    })
    it('sincronização consulta somente não lidas sem confirmar leitura automaticamente', async () => {
      const lida = await evento()
      const nova = await evento()
      await pg`UPDATE notificacoes SET lida_at=now() WHERE id=${lida}`
      const resposta = await request(app.getHttpServer())
        .get('/notificacoes?somente_nao_lidas=true&limite=100')
        .set('Authorization', bearer)
        .expect(200)
      expect(resposta.body.items.map((n: { id: string }) => n.id)).toEqual([
        nova,
      ])
      expect(resposta.body.nao_lidas).toBe(1)
      expect(
        (await pg`SELECT lida_at FROM notificacoes WHERE id=${nova}`)[0]
          .lida_at,
      ).toBeNull()
    })
    it('falha permanente encerra tentativas e reprocessamento explícito recupera bloqueada', async () => {
      const id = await evento()
      const permanente: CanalEntrega = {
        enviar: async () => {
          throw new FalhaEntrega('SMTP_550', true)
        },
        fechar() {},
      }
      await new WorkerNotificacoes(
        repo,
        { email: permanente },
        2,
        () => {},
      ).ciclo()
      const [falhou] =
        await pg`SELECT * FROM entregas_notificacao WHERE notificacao_id=${id}`
      expect(falhou.estado).toBe('FALHOU')
      expect(await repo.reservar(1)).toHaveLength(0)
      await pg`UPDATE entregas_notificacao SET estado='BLOQUEADA' WHERE id=${falhou.id}`
      const filho = spawn(
        'bun',
        ['run', 'src/notificacoes/reprocessar.ts', falhou.id],
        {
          env: { ...process.env, DATABASE_URL: url.toString() },
          stdio: 'ignore',
        },
      )
      const [codigo] = await once(filho, 'exit')
      expect(codigo).toBe(0)
      const [retomada] = await repo.reservar(1)
      expect(retomada.id).toBe(falhou.id)
      expect(retomada.tentativas).toBe(1)
    })

    it('falha no status da outbox reverte também a finalização da entrega', async () => {
      const id = await evento()
      await repo.expandir(100)
      const [entrega] = await repo.reservar(1)
      await pg.unsafe(`CREATE FUNCTION falhar_status_qa() RETURNS trigger AS $$ BEGIN
        RAISE EXCEPTION 'falha de teste'; END; $$ LANGUAGE plpgsql;
        CREATE TRIGGER status_qa BEFORE UPDATE ON notificacoes FOR EACH ROW EXECUTE FUNCTION falhar_status_qa()`)
      try {
        await expect(repo.finalizar(entrega, 'ENVIADA', null)).rejects.toThrow()
        expect(
          (
            await pg`SELECT estado FROM entregas_notificacao WHERE id=${entrega.id}`
          )[0].estado,
        ).toBe('PROCESSANDO')
        expect(
          (await pg`SELECT status FROM notificacoes WHERE id=${id}`)[0].status,
        ).toBe('PENDENTE')
      } finally {
        await pg.unsafe(
          'DROP TRIGGER status_qa ON notificacoes; DROP FUNCTION falhar_status_qa()',
        )
      }
    })
    it('detalhe do plantão exige notificação destinada ao usuário autenticado', async () => {
      await evento()
      const detalhe = await request(app.getHttpServer())
        .get(`/notificacoes/plantoes/${plantao}`)
        .set('Authorization', bearer)
        .expect(200)
      expect(detalhe.body.id).toBe(plantao)
      const [estranho] =
        await pg`INSERT INTO usuarios (nome,email,senha_hash,tipo) VALUES ('Estranho','estranho@example.test','hash','MEDICO') RETURNING id`
      const token = await app.get(JwtService).signAsync({ sub: estranho.id })
      await request(app.getHttpServer())
        .get(`/notificacoes/plantoes/${plantao}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(404)
    })
  },
)
