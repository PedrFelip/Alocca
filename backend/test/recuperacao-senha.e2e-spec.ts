import { PGlite } from '@electric-sql/pglite'
import { type INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import { drizzle } from 'drizzle-orm/pglite'
import { readFile, readdir } from 'node:fs/promises'
import request from 'supertest'
import { AppModule } from '../src/app.module.ts'
import { PasswordService } from '../src/auth/password.service.ts'
import {
  hashDoToken,
  RecuperacaoSenhaService,
} from '../src/auth/recuperacao-senha.service.ts'
import { DRIZZLE_DB } from '../src/db/db.provider.ts'
import { EmailService, type Email } from '../src/email/email.service.ts'

const MSG_05 =
  'Se o e-mail constar em nossa base, um link de redefinição será enviado.'
const MSG_06 = 'Link de redefinição inválido ou expirado.'
const MSG_08 = 'Senha atualizada com sucesso!'

describe('UC04 recuperação de senha', () => {
  let app: INestApplication
  let database: PGlite
  let usuarioId: string
  // no lugar do smtp: guarda o que seria enviado
  const enviados: Email[] = []
  let segurarEnvio: Promise<void> | undefined

  function pedir(email = 'maria@example.com') {
    return request(app.getHttpServer())
      .post('/auth/recuperar-senha')
      .send({ email })
  }

  async function codigosValendo() {
    const res = await database.query(
      'SELECT id FROM tokens_recuperacao_senha WHERE used_at IS NULL',
    )
    return res.rows.length
  }

  async function criarToken(
    token: string,
    validade = "now() + interval '15 minutes'",
  ) {
    await database.query(
      `INSERT INTO tokens_recuperacao_senha (usuario_id, token, expires_at) VALUES ($1, $2, ${validade})`,
      [usuarioId, hashDoToken(token)],
    )
  }

  function login(senha: string) {
    return request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: 'maria@example.com', senha })
  }

  beforeAll(async () => {
    database = new PGlite()
    for (const directory of (await readdir('drizzle')).sort()) {
      await database.exec(
        await readFile(`drizzle/${directory}/migration.sql`, 'utf8'),
      )
    }
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(DRIZZLE_DB)
      .useValue(drizzle({ client: database }))
      .overrideProvider(EmailService)
      .useValue({
        enviar: async (email: Email) => {
          await segurarEnvio
          enviados.push(email)
        },
      })
      .compile()
    app = module.createNestApplication()
    await app.init()
  }, 30000)

  afterAll(async () => {
    await app?.close()
    await database?.close()
  })

  beforeEach(async () => {
    enviados.length = 0
    await database.exec(
      'TRUNCATE tokens_recuperacao_senha, medicos, usuarios CASCADE',
    )
    const senha_hash = await app.get(PasswordService).hash('Senha-Antiga-123')
    usuarioId = (
      await database.query<{ id: string }>(
        `INSERT INTO usuarios (nome, email, senha_hash, tipo) VALUES ('Maria', 'maria@example.com', $1, 'MEDICO') RETURNING id`,
        [senha_hash],
      )
    ).rows[0].id
  })

  it('e-mail que não existe recebe a mesma resposta e nada é enviado (RN12)', async () => {
    const res = await pedir('ninguem@example.com')
    expect(res.status).toBe(200)
    expect(res.body.message).toBe(MSG_05)
    expect(enviados).toHaveLength(0)
  })

  it('conta ativa responde sem esperar o código ser gerado e enviado (RN12)', async () => {
    let soltar!: () => void
    segurarEnvio = new Promise((resolve) => (soltar = resolve))
    const res = await pedir()
    expect(res.status).toBe(200)
    expect(res.body.message).toBe(MSG_05)
    expect(enviados).toHaveLength(0)

    soltar()
    segurarEnvio = undefined
    await vi.waitFor(() => expect(enviados).toHaveLength(1))
  })

  it('e-mail cadastrado recebe o código e o banco guarda só o hash', async () => {
    const res = await pedir('Maria@Example.com')
    expect(res.status).toBe(200)
    expect(res.body.message).toBe(MSG_05)
    await vi.waitFor(() => expect(enviados).toHaveLength(1))
    expect(enviados[0].para).toBe('maria@example.com')

    const salvo = (
      await database.query<{ token: string; minutos: number }>(
        `SELECT token, extract(epoch from expires_at - created_at) / 60 AS minutos FROM tokens_recuperacao_senha`,
      )
    ).rows
    expect(salvo).toHaveLength(1)
    const token = enviados[0].texto
      .split('\n')
      .find((linha) => linha === linha.trim() && /^[\w-]{40,}$/.test(linha))!
    expect(salvo[0].token).toBe(hashDoToken(token))
    expect(salvo[0].token).not.toBe(token)
    expect(Math.round(Number(salvo[0].minutos))).toBe(15)
  })

  it('pedir de novo invalida o código anterior', async () => {
    await pedir()
    await vi.waitFor(() => expect(enviados).toHaveLength(1))
    await pedir()
    await vi.waitFor(() => expect(enviados).toHaveLength(2))
    expect(await codigosValendo()).toBe(1)
  })

  it('pedidos ao mesmo tempo deixam só um código valendo', async () => {
    // direto no service: pela rota o limite de 5/min ja teria estourado
    const servico = app.get(RecuperacaoSenhaService)
    const email = 'maria@example.com'
    await Promise.all([1, 2, 3].map(() => servico.solicitar({ email })))
    await vi.waitFor(() => expect(enviados).toHaveLength(3))
    expect(await codigosValendo()).toBe(1)
  })

  it('troca a senha com código válido e o código não serve de novo (RN11)', async () => {
    await criarToken('codigo-valido')
    const res = await request(app.getHttpServer())
      .post('/auth/redefinir-senha')
      .send({ token: 'codigo-valido', nova_senha: 'Senha-Nova-456' })
    expect(res.status).toBe(200)
    expect(res.body.message).toBe(MSG_08)

    expect((await login('Senha-Nova-456')).status).toBe(200)
    expect((await login('Senha-Antiga-123')).status).toBe(401)

    const deNovo = await request(app.getHttpServer())
      .post('/auth/redefinir-senha')
      .send({ token: 'codigo-valido', nova_senha: 'Outra-Senha-789' })
    expect(deNovo.status).toBe(400)
    expect(deNovo.body.message).toBe(MSG_06)
  })

  it('código vencido não troca a senha (RN11)', async () => {
    await criarToken('codigo-vencido', "now() - interval '1 minute'")
    const res = await request(app.getHttpServer())
      .post('/auth/redefinir-senha')
      .send({ token: 'codigo-vencido', nova_senha: 'Senha-Nova-456' })
    expect(res.status).toBe(400)
    expect(res.body.message).toBe(MSG_06)
    expect((await login('Senha-Antiga-123')).status).toBe(200)
  })

  it('código inventado e senha fraca são recusados', async () => {
    const inventado = await request(app.getHttpServer())
      .post('/auth/redefinir-senha')
      .send({ token: 'nao-existe', nova_senha: 'Senha-Nova-456' })
    expect(inventado.status).toBe(400)
    expect(inventado.body.message).toBe(MSG_06)

    await criarToken('codigo-valido')
    const fraca = await request(app.getHttpServer())
      .post('/auth/redefinir-senha')
      .send({ token: 'codigo-valido', nova_senha: '123' })
    expect(fraca.status).toBe(400)
    // senha fraca nao gasta o codigo
    const ainda = await database.query(
      'SELECT id FROM tokens_recuperacao_senha WHERE used_at IS NULL',
    )
    expect(ainda.rows).toHaveLength(1)
  })
})
