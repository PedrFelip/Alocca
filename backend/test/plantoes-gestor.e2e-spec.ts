import { PGlite } from '@electric-sql/pglite'
import type { INestApplication } from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'
import { Test } from '@nestjs/testing'
import { drizzle } from 'drizzle-orm/pglite'
import { readFile, readdir } from 'node:fs/promises'
import request from 'supertest'
import { AppModule } from '../src/app.module.ts'
import { DRIZZLE_DB } from '../src/db/db.provider.ts'

describe('Plantões do gestor', () => {
  let app: INestApplication
  let db: PGlite
  let usuario: string
  let outro: string
  let gestor: string
  let token: string
  async function criarUsuario(tipo = 'GESTOR') {
    const r = await db.query<{ id: string }>(
      'INSERT INTO usuarios (nome, email, senha_hash, tipo) VALUES ($1, $2, $3, $4) RETURNING id',
      [tipo, `${crypto.randomUUID()}@example.com`, 'hash', tipo],
    )
    return r.rows[0].id
  }
  async function bearer(id: string) {
    return `Bearer ${await app.get(JwtService).signAsync({ sub: id })}`
  }
  function listar(auth = token) {
    return request(app.getHttpServer())
      .get('/plantoes/gestor')
      .set('Authorization', auth)
  }
  async function instituicao(dono: string) {
    const r = await db.query<{ id: string }>(
      "INSERT INTO instituicoes (usuario_id, nome, cnpj) VALUES ($1, 'Hospital', $2) RETURNING id",
      [dono, crypto.randomUUID().replaceAll('-', '').slice(0, 14)],
    )
    return r.rows[0].id
  }
  async function plantao(
    instituicaoId: string,
    criador = outro,
    status = 'ABERTO',
  ) {
    const r = await db.query<{ id: string }>(
      `INSERT INTO plantoes (instituicao_id, gestor_criador_id, titulo, local_unidade, especialidade, data_inicio, data_fim, valor, quantidade_vagas, vagas_disponiveis, status)
      VALUES ($1, $2, 'Plantão', 'UTI', 'Clínica', '2025-01-01 08:00', '2025-01-01 20:00', 1000, 1, 0, $3) RETURNING id`,
      [instituicaoId, criador, status],
    )
    return r.rows[0].id
  }
  beforeAll(async () => {
    db = new PGlite()
    for (const dir of (await readdir('drizzle')).sort())
      await db.exec(await readFile(`drizzle/${dir}/migration.sql`, 'utf8'))
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(DRIZZLE_DB)
      .useValue(drizzle({ client: db }))
      .compile()
    app = module.createNestApplication()
    await app.init()
  }, 30000)
  beforeEach(async () => {
    await db.exec('TRUNCATE usuarios CASCADE')
    usuario = await criarUsuario()
    outro = await criarUsuario()
    const r = await db.query<{ id: string }>(
      'INSERT INTO gestores (usuario_id) VALUES ($1) RETURNING id',
      [usuario],
    )
    gestor = r.rows[0].id
    token = await bearer(usuario)
  })
  afterAll(async () => {
    await app?.close()
    await db?.close()
  })
  it('exige autenticação e papel GESTOR', async () => {
    await request(app.getHttpServer()).get('/plantoes/gestor').expect(401)
    await listar('Bearer invalido').expect(401)
    for (const tipo of ['MEDICO', 'ADMIN'])
      await listar(await bearer(await criarUsuario(tipo))).expect(403)
  })
  it('recusa perfil ausente, inativo ou excluído', async () => {
    await listar(await bearer(outro)).expect(404)
    await db.query('UPDATE gestores SET ativa = false WHERE id = $1', [gestor])
    await listar().expect(404)
    await db.query(
      'UPDATE gestores SET ativa = true, deleted_at = now() WHERE id = $1',
      [gestor],
    )
    await listar().expect(404)
  })
  it('recusa usuário excluído com token válido', async () => {
    await db.query('UPDATE usuarios SET deleted_at = now() WHERE id = $1', [
      usuario,
    ])
    await listar().expect(401)
  })
  it('retorna vazio sem plantões administrados', async () => {
    await plantao(await instituicao(outro))
    expect((await listar().expect(200)).body).toEqual([])
  })
  it('inclui autoria, propriedade e vínculo sem duplicação ou vazamento, em todos os status', async () => {
    const propria = await instituicao(usuario)
    const vinculada = await instituicao(outro)
    await db.query(
      'INSERT INTO gestores_instituicoes (gestor_id, instituicao_id) VALUES ($1, $2), ($1, $3)',
      [gestor, propria, vinculada],
    )
    const ids = [
      await plantao(await instituicao(outro), usuario, 'CANCELADO'),
      await plantao(propria, usuario, 'PREENCHIDO'),
      await plantao(vinculada, outro, 'CONCLUIDO'),
      await plantao(propria),
    ]
    await plantao(await instituicao(outro))
    const response = await listar().expect(200)
    expect(response.body.map((p: { id: string }) => p.id)).toEqual(
      [...ids].sort(),
    )
    expect(response.body.find((p: { id: string }) => p.id === ids[0])).toEqual({
      id: ids[0],
      titulo: 'Plantão',
      especialidade: 'Clínica',
      data_inicio: '2025-01-01T08:00:00.000Z',
      data_fim: '2025-01-01T20:00:00.000Z',
      status: 'CANCELADO',
      vagas_disponiveis: 0,
      instituicao: 'Hospital',
    })
  })
  it('exclui registros removidos e ordena por início antes do id', async () => {
    const propria = await instituicao(usuario)
    const removida = await instituicao(usuario)
    const primeiro = await plantao(propria)
    const segundo = await plantao(propria)
    const excluido = await plantao(propria)
    await plantao(removida, usuario)
    await db.query('UPDATE instituicoes SET deleted_at = now() WHERE id = $1', [
      removida,
    ])
    await db.query('UPDATE plantoes SET deleted_at = now() WHERE id = $1', [
      excluido,
    ])
    await db.query(
      "UPDATE plantoes SET data_inicio = '2024-12-31 08:00' WHERE id = $1",
      [segundo],
    )
    expect(
      (await listar().expect(200)).body.map((p: { id: string }) => p.id),
    ).toEqual([segundo, primeiro])
  })
})
