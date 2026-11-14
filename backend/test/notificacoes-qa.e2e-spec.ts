import { PGlite } from '@electric-sql/pglite'
import { type INestApplication } from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'
import { Test } from '@nestjs/testing'
import { drizzle } from 'drizzle-orm/pglite'
import { readFile, readdir } from 'node:fs/promises'
import request from 'supertest'
import { AppModule } from '../src/app.module.ts'
import { DRIZZLE_DB } from '../src/db/db.provider.ts'

describe('Notificações — regressões de segurança e inbox', () => {
  let db: PGlite
  let app: INestApplication
  let ids: string[]
  let tokens: string[]
  let notificationIds: string[]

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
      ('QA Um', 'qa-inbox-1@example.com', 'hash', 'MEDICO'),
      ('QA Dois', 'qa-inbox-2@example.com', 'hash', 'MEDICO'),
      ('QA Sessão', 'qa-inbox-3@example.com', 'hash', 'MEDICO') RETURNING id`)
    ).rows.map((row) => row.id)
    const institution = (
      await db.query<{ id: string }>(
        `INSERT INTO instituicoes (usuario_id, nome, cnpj, cidade, uf)
      VALUES ($1, 'Hospital QA', '22222222000122', 'Brasília', 'DF') RETURNING id`,
        [ids[0]],
      )
    ).rows[0].id
    const shift = (
      await db.query<{ id: string }>(
        `INSERT INTO plantoes (instituicao_id, gestor_criador_id, titulo, local_unidade,
      especialidade, data_inicio, data_fim, valor, quantidade_vagas, vagas_disponiveis, status)
      VALUES ($1, $2, 'Plantão', 'UTI', 'Clínica', '2030-01-01', '2030-01-02', 100, 1, 1, 'ABERTO') RETURNING id`,
        [institution, ids[0]],
      )
    ).rows[0].id
    notificationIds = (
      await db.query<{ id: string }>(
        `INSERT INTO notificacoes (usuario_destino_id, plantao_id, tipo, created_at)
      SELECT $1, $2, 'ALOCACAO_APROVADA', '2030-01-01 12:00:00' FROM generate_series(1, 5) RETURNING id`,
        [ids[0], shift],
      )
    ).rows.map((row) => row.id)
    await db.query(
      `INSERT INTO notificacoes (usuario_destino_id, plantao_id, tipo) VALUES ($1, $2, 'ALOCACAO_APROVADA')`,
      [ids[1], shift],
    )
    const jwt = app.get(JwtService)
    tokens = await Promise.all(
      ids.map(async (id) => `Bearer ${await jwt.signAsync({ sub: id })}`),
    )
  }, 30000)

  afterAll(async () => {
    await app?.close()
    await db?.close()
  })

  it('rejeita credenciais inválidas e sessão de conta excluída', async () => {
    for (const path of ['/notificacoes', '/notificacoes/preferencias']) {
      await request(app.getHttpServer()).get(path).expect(401)
      await request(app.getHttpServer())
        .get(path)
        .set('Authorization', 'Bearer invalid')
        .expect(401)
    }
    await db.query('UPDATE usuarios SET deleted_at = now() WHERE id = $1', [
      ids[2],
    ])
    await request(app.getHttpServer())
      .get('/notificacoes')
      .set('Authorization', tokens[2])
      .expect(401)
    await request(app.getHttpServer())
      .put('/notificacoes/preferencias')
      .set('Authorization', tokens[2])
      .send({ push: true, email: true })
      .expect(401)
  })

  it('rejeita parâmetros e corpos inválidos sem persistir alterações', async () => {
    for (const query of [
      'limite=0',
      'limite=101',
      'limite=1.5',
      'limite=abc',
      'cursor=invalid',
      'extra=1',
    ]) {
      await request(app.getHttpServer())
        .get(`/notificacoes?${query}`)
        .set('Authorization', tokens[0])
        .expect(400)
    }
    await request(app.getHttpServer())
      .patch('/notificacoes/invalid/lida')
      .set('Authorization', tokens[0])
      .expect(400)
    for (const body of [
      { push: 'true', email: false },
      { push: true },
      { push: true, email: false, usuario_id: ids[1] },
    ]) {
      await request(app.getHttpServer())
        .put('/notificacoes/preferencias')
        .set('Authorization', tokens[0])
        .send(body)
        .expect(400)
    }
    const prefs = await request(app.getHttpServer())
      .get('/notificacoes/preferencias')
      .set('Authorization', tokens[0])
      .expect(200)
    expect(prefs.body).toEqual({ push: false, email: false })
  })

  it('percorre timestamps iguais sem duplicatas, isola leitura e mantém contagem idempotente', async () => {
    const seen: string[] = []
    let cursor: string | null = null
    do {
      const response = await request(app.getHttpServer())
        .get('/notificacoes')
        .query({ limite: 2, ...(cursor ? { cursor } : {}) })
        .set('Authorization', tokens[0])
        .expect(200)
      expect(response.body.nao_lidas).toBe(5)
      seen.push(...response.body.items.map((item: { id: string }) => item.id))
      cursor = response.body.next_cursor
    } while (cursor && seen.length <= 5)
    expect(seen).toEqual([...notificationIds].sort().reverse())
    await request(app.getHttpServer())
      .patch(`/notificacoes/${seen[0]}/lida`)
      .set('Authorization', tokens[1])
      .expect(404)
    const first = await request(app.getHttpServer())
      .patch(`/notificacoes/${seen[0]}/lida`)
      .set('Authorization', tokens[0])
      .expect(200)
    const second = await request(app.getHttpServer())
      .patch(`/notificacoes/${seen[0]}/lida`)
      .set('Authorization', tokens[0])
      .expect(200)
    expect(second.body.lida_at).toBe(first.body.lida_at)
    expect(first.body.lida_at).toBeTruthy()
    const own = await request(app.getHttpServer())
      .get('/notificacoes')
      .set('Authorization', tokens[0])
      .expect(200)
    const other = await request(app.getHttpServer())
      .get('/notificacoes')
      .set('Authorization', tokens[1])
      .expect(200)
    expect(own.body.nao_lidas).toBe(4)
    expect(other.body.nao_lidas).toBe(1)
    expect(
      other.body.items.map((item: { id: string }) => item.id),
    ).not.toContain(seen[0])
  })

  it('persiste atualização de preferências por conta', async () => {
    await request(app.getHttpServer())
      .put('/notificacoes/preferencias')
      .set('Authorization', tokens[0])
      .send({ push: true, email: false })
      .expect(200)
    await request(app.getHttpServer())
      .put('/notificacoes/preferencias')
      .set('Authorization', tokens[1])
      .send({ push: false, email: true })
      .expect(200)
    await request(app.getHttpServer())
      .put('/notificacoes/preferencias')
      .set('Authorization', tokens[0])
      .send({ push: false, email: true })
      .expect(200)
    await request(app.getHttpServer())
      .put('/notificacoes/preferencias')
      .set('Authorization', tokens[1])
      .send({ push: true, email: false })
      .expect(200)
    expect(
      (
        await request(app.getHttpServer())
          .get('/notificacoes/preferencias')
          .set('Authorization', tokens[0])
          .expect(200)
      ).body,
    ).toEqual({ push: false, email: true })
    expect(
      (
        await request(app.getHttpServer())
          .get('/notificacoes/preferencias')
          .set('Authorization', tokens[1])
          .expect(200)
      ).body,
    ).toEqual({ push: true, email: false })
    expect(
      (await db.query('SELECT usuario_id FROM preferencias_notificacao')).rows,
    ).toHaveLength(2)
  })
})
