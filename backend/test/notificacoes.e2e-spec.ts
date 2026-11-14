import { PGlite } from '@electric-sql/pglite'
import { type INestApplication } from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'
import { Test } from '@nestjs/testing'
import { drizzle } from 'drizzle-orm/pglite'
import { readFile, readdir } from 'node:fs/promises'
import request from 'supertest'
import { AppModule } from '../src/app.module.ts'
import { DRIZZLE_DB } from '../src/db/db.provider.ts'

describe('Notificações', () => {
  let db: PGlite
  let app: INestApplication
  let tokens: string[]
  let ids: string[]
  let notificacao: string

  beforeAll(async () => {
    db = new PGlite()
    for (const dir of (await readdir('drizzle')).sort()) {
      await db.exec(await readFile(`drizzle/${dir}/migration.sql`, 'utf8'))
    }
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(DRIZZLE_DB)
      .useValue(drizzle({ client: db }))
      .compile()
    app = module.createNestApplication()
    await app.init()
    ids = (
      await db.query<{
        id: string
      }>(`INSERT INTO usuarios (nome, email, senha_hash, tipo) VALUES
      ('Um', 'um@example.com', 'hash', 'MEDICO'), ('Dois', 'dois@example.com', 'hash', 'MEDICO') RETURNING id`)
    ).rows.map((u) => u.id)
    const instituicao = (
      await db.query<{ id: string }>(
        `INSERT INTO instituicoes (usuario_id, nome, cnpj, cidade, uf)
      VALUES ($1, 'Hospital', '11111111000111', 'Brasília', 'DF') RETURNING id`,
        [ids[0]],
      )
    ).rows[0].id
    const plantao = (
      await db.query<{ id: string }>(
        `INSERT INTO plantoes (instituicao_id, gestor_criador_id, titulo, local_unidade,
      especialidade, data_inicio, data_fim, valor, quantidade_vagas, vagas_disponiveis, status)
      VALUES ($1, $2, 'Plantão', 'UTI', 'Clínica', '2030-01-01', '2030-01-02', 100, 1, 1, 'ABERTO') RETURNING id`,
        [instituicao, ids[0]],
      )
    ).rows[0].id
    notificacao = (
      await db.query<{ id: string }>(
        `INSERT INTO notificacoes (usuario_destino_id, plantao_id, tipo) VALUES ($1, $2, 'ALOCACAO_APROVADA') RETURNING id`,
        [ids[0], plantao],
      )
    ).rows[0].id
    const jwt = app.get(JwtService)
    tokens = await Promise.all(
      ids.map(async (id) => `Bearer ${await jwt.signAsync({ sub: id })}`),
    )
  }, 30000)

  afterAll(async () => {
    await app?.close()
    await db?.close()
  })

  it('exige autenticação e isola histórico e leitura', async () => {
    await request(app.getHttpServer()).get('/notificacoes').expect(401)
    const lista = await request(app.getHttpServer())
      .get('/notificacoes')
      .set('Authorization', tokens[0])
      .expect(200)
    expect(lista.body.items).toHaveLength(1)
    const outra = await request(app.getHttpServer())
      .get('/notificacoes')
      .set('Authorization', tokens[1])
      .expect(200)
    expect(outra.body.items).toHaveLength(0)
    await request(app.getHttpServer())
      .patch(`/notificacoes/${notificacao}/lida`)
      .set('Authorization', tokens[1])
      .expect(404)
    const lida = await request(app.getHttpServer())
      .patch(`/notificacoes/${notificacao}/lida`)
      .set('Authorization', tokens[0])
      .expect(200)
    const repetida = await request(app.getHttpServer())
      .patch(`/notificacoes/${notificacao}/lida`)
      .set('Authorization', tokens[0])
      .expect(200)
    expect(repetida.body.lida_at).toBe(lida.body.lida_at)
  })

  it('pagina por cursor e conta somente notificações não lidas do usuário', async () => {
    await db.query(
      `INSERT INTO notificacoes (usuario_destino_id, plantao_id, tipo, created_at)
      SELECT usuario_destino_id, plantao_id, tipo, created_at FROM notificacoes WHERE id = $1`,
      [notificacao],
    )
    const primeira = await request(app.getHttpServer())
      .get('/notificacoes?limite=1')
      .set('Authorization', tokens[0])
      .expect(200)
    expect(primeira.body.items).toHaveLength(1)
    expect(primeira.body.next_cursor).toBe(primeira.body.items[0].id)
    expect(primeira.body.nao_lidas).toBe(1)
    const segunda = await request(app.getHttpServer())
      .get(`/notificacoes?limite=1&cursor=${primeira.body.next_cursor}`)
      .set('Authorization', tokens[0])
      .expect(200)
    expect(segunda.body.items).toHaveLength(1)
    expect(segunda.body.items[0].id).not.toBe(primeira.body.items[0].id)
    expect(segunda.body.next_cursor).toBeNull()
    const isolada = await request(app.getHttpServer())
      .get(`/notificacoes?cursor=${primeira.body.next_cursor}`)
      .set('Authorization', tokens[1])
      .expect(200)
    expect(isolada.body.items).toHaveLength(0)
    expect(isolada.body.nao_lidas).toBe(0)
    await request(app.getHttpServer())
      .get('/notificacoes?limite=101')
      .set('Authorization', tokens[0])
      .expect(400)
  })

  it('isola preferências por usuário', async () => {
    await request(app.getHttpServer())
      .put('/notificacoes/preferencias')
      .set('Authorization', tokens[0])
      .send({ push: true, email: true })
      .expect(200)
    const outra = await request(app.getHttpServer())
      .get('/notificacoes/preferencias')
      .set('Authorization', tokens[1])
      .expect(200)
    expect(outra.body).toEqual({ push: false, email: false })
  })
})
