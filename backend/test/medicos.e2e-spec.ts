import { PGlite } from '@electric-sql/pglite'
import type { INestApplication } from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'
import { Test } from '@nestjs/testing'
import { drizzle } from 'drizzle-orm/pglite'
import { readFile, readdir } from 'node:fs/promises'
import request from 'supertest'
import { AppModule } from '../src/app.module.ts'
import { PasswordService } from '../src/auth/password.service.ts'
import { DRIZZLE_DB } from '../src/db/db.provider.ts'

describe('Validação manual de médicos', () => {
  let app: INestApplication
  let database: PGlite
  let adminId: string
  let medicoId: string
  let medicoUsuarioId: string
  let adminToken: string
  let medicoToken: string
  let gestorToken: string
  let hash: string
  const registro = { nome: 'MEDICO', crm: '123456', uf_crm: 'SP' }
  const aprovacao = { ...registro, status_validacao: 'APROVADO' }

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
      .compile()
    app = module.createNestApplication()
    await app.init()
    hash = await app.get(PasswordService).hash('senha-segura-123')
  }, 30000)

  beforeEach(async () => {
    await database.exec(
      'TRUNCATE notificacoes, medicos, usuarios, tokens_recuperacao_senha CASCADE',
    )
    async function criarUsuario(tipo: string): Promise<string> {
      const result = await database.query<{ id: string }>(
        'INSERT INTO usuarios (nome, email, senha_hash, tipo) VALUES ($1, $2, $3, $4) RETURNING id',
        [tipo, `${tipo.toLowerCase()}@example.com`, hash, tipo],
      )
      return result.rows[0].id
    }
    adminId = await criarUsuario('ADMIN')
    medicoUsuarioId = await criarUsuario('MEDICO')
    const gestorId = await criarUsuario('GESTOR')
    const result = await database.query<{ id: string }>(
      "INSERT INTO medicos (usuario_id, crm, uf_crm) VALUES ($1, '123456', 'SP') RETURNING id",
      [medicoUsuarioId],
    )
    medicoId = result.rows[0].id
    const jwt = app.get(JwtService)
    adminToken = `Bearer ${await jwt.signAsync({ sub: adminId })}`
    medicoToken = `Bearer ${await jwt.signAsync({ sub: medicoUsuarioId })}`
    gestorToken = `Bearer ${await jwt.signAsync({ sub: gestorId })}`
  })

  afterAll(async () => {
    await app?.close()
    await database?.close()
  })

  function decidir(body = aprovacao) {
    return request(app.getHttpServer())
      .patch(`/admin/medicos/${medicoId}/validacao`)
      .set('Authorization', adminToken)
      .send(body)
  }

  it('cadastra um médico pendente sem aceitar status informado pelo solicitante', async () => {
    const cadastro = {
      nome: 'Médico novo',
      cpf: '123.456.789-09',
      email: 'novo@example.com',
      senha: 'Senha-Segura-123',
      crm: '654321',
      uf_crm: 'RJ',
    }
    const response = await request(app.getHttpServer())
      .post('/auth/register/medico')
      .send(cadastro)
      .expect(201)
    expect(response.body.medico.status_validacao).toBe('PENDENTE')
    await request(app.getHttpServer())
      .post('/auth/register/medico')
      .send({ ...cadastro, status_validacao: 'APROVADO' })
      .expect(400)
  })

  it('permite listar e decidir apenas com usuário ADMIN ativo', async () => {
    await request(app.getHttpServer())
      .get('/admin/medicos/pendentes')
      .expect(401)
    for (const token of [medicoToken, gestorToken]) {
      await request(app.getHttpServer())
        .get('/admin/medicos/pendentes')
        .set('Authorization', token)
        .expect(403)
      await request(app.getHttpServer())
        .patch(`/admin/medicos/${medicoId}/validacao`)
        .set('Authorization', token)
        .send(aprovacao)
        .expect(403)
    }
    const response = await request(app.getHttpServer())
      .get('/admin/medicos/pendentes')
      .set('Authorization', adminToken)
      .expect(200)
    expect(response.body).toHaveLength(1)
    expect(response.body[0]).toMatchObject({ medico_id: medicoId, ...registro })
    await database.query(
      "UPDATE usuarios SET status = 'BLOQUEADO' WHERE id = $1",
      [adminId],
    )
    await decidir().expect(401)
  })

  it('aprova registrando responsável e data, e impede uma segunda decisão', async () => {
    const response = await decidir().expect(200)
    expect(response.body).toMatchObject({
      status_validacao: 'APROVADO',
      validado_por_usuario_id: adminId,
      motivo_rejeicao: null,
    })
    expect(response.body.validado_at).toBeTruthy()
    const profile = await request(app.getHttpServer())
      .get('/usuarios/me')
      .set('Authorization', medicoToken)
      .expect(200)
    expect(profile.body.medico.status_validacao).toBe('APROVADO')
    await decidir().expect(409)
  })

  it('exige motivo para rejeição e permite corrigir o registro para nova análise', async () => {
    await decidir({ ...registro, status_validacao: 'REJEITADO' }).expect(400)
    const rejected = await request(app.getHttpServer())
      .patch(`/admin/medicos/${medicoId}/validacao`)
      .set('Authorization', adminToken)
      .send({
        ...registro,
        status_validacao: 'REJEITADO',
        motivo_rejeicao: 'CRM divergente',
      })
      .expect(200)
    expect(rejected.body.motivo_rejeicao).toBe('CRM divergente')
    const corrected = await request(app.getHttpServer())
      .patch('/usuarios/me')
      .set('Authorization', medicoToken)
      .send({ crm: '777777' })
      .expect(200)
    expect(corrected.body.medico).toMatchObject({
      status_validacao: 'PENDENTE',
      validado_at: null,
      validado_por_usuario_id: null,
      motivo_rejeicao: null,
    })
  })

  it('mantém aprovação ao reenviar o mesmo registro e volta a pendente ao mudar UF', async () => {
    await decidir().expect(200)
    const same = await request(app.getHttpServer())
      .patch('/usuarios/me')
      .set('Authorization', medicoToken)
      .send(registro)
      .expect(200)
    expect(same.body.medico.status_validacao).toBe('APROVADO')
    const changed = await request(app.getHttpServer())
      .patch('/usuarios/me')
      .set('Authorization', medicoToken)
      .send({ uf_crm: 'MG' })
      .expect(200)
    expect(changed.body.medico).toMatchObject({
      status_validacao: 'PENDENTE',
      validado_at: null,
      validado_por_usuario_id: null,
    })
  })

  it('rejeita decisão feita sobre CRM antigo', async () => {
    await request(app.getHttpServer())
      .patch('/usuarios/me')
      .set('Authorization', medicoToken)
      .send({ crm: '777777' })
      .expect(200)
    await decidir().expect(409)
    await decidir({ ...aprovacao, crm: '777777' }).expect(200)
  })

  it.each(['APROVADO', 'REJEITADO'])(
    'exige nova análise após mudança de nome para decidir %s',
    async (status_validacao) => {
      const fila = await request(app.getHttpServer())
        .get('/admin/medicos/pendentes')
        .set('Authorization', adminToken)
        .expect(200)
      const revisado = fila.body[0]
      const decision = {
        nome: revisado.nome,
        crm: revisado.crm,
        uf_crm: revisado.uf_crm,
        status_validacao,
        ...(status_validacao === 'REJEITADO' && {
          motivo_rejeicao: 'Identidade divergente',
        }),
      }
      await request(app.getHttpServer())
        .patch('/usuarios/me')
        .set('Authorization', medicoToken)
        .send({ nome: 'Nome corrigido' })
        .expect(200)
      await decidir(decision).expect(409)
      const perfil = await request(app.getHttpServer())
        .get('/usuarios/me')
        .set('Authorization', medicoToken)
        .expect(200)
      expect(perfil.body.medico).toMatchObject({
        status_validacao: 'PENDENTE',
        validado_por_usuario_id: null,
        validado_at: null,
      })
      const atualizada = await request(app.getHttpServer())
        .get('/admin/medicos/pendentes')
        .set('Authorization', adminToken)
        .expect(200)
      await decidir({ ...decision, nome: atualizada.body[0].nome }).expect(200)
    },
  )

  it('exige o nome revisado na decisão', async () => {
    const { nome: _nome, ...semNome } = aprovacao
    await request(app.getHttpServer())
      .patch(`/admin/medicos/${medicoId}/validacao`)
      .set('Authorization', adminToken)
      .send(semNome)
      .expect(400)
  })

  it('desfaz alterações no usuário quando há CRM duplicado', async () => {
    const other = await database.query<{ id: string }>(
      "INSERT INTO usuarios (nome, email, senha_hash, tipo) VALUES ('Outro', 'outro@example.com', $1, 'MEDICO') RETURNING id",
      [hash],
    )
    await database.query(
      "INSERT INTO medicos (usuario_id, crm, uf_crm) VALUES ($1, '999999', 'SP')",
      [other.rows[0].id],
    )
    await decidir().expect(200)
    await request(app.getHttpServer())
      .patch('/usuarios/me')
      .set('Authorization', medicoToken)
      .send({ nome: 'Alterado', crm: '999999' })
      .expect(409)
    const profile = await request(app.getHttpServer())
      .get('/usuarios/me')
      .set('Authorization', medicoToken)
      .expect(200)
    expect(profile.body.nome).toBe('MEDICO')
    expect(profile.body.medico).toMatchObject({
      crm: '123456',
      status_validacao: 'APROVADO',
    })
  })

  it('impede autoaprovação e análise de perfil excluído', async () => {
    const own = await database.query<{ id: string }>(
      "INSERT INTO medicos (usuario_id, crm, uf_crm) VALUES ($1, '888888', 'SP') RETURNING id",
      [adminId],
    )
    await request(app.getHttpServer())
      .patch(`/admin/medicos/${own.rows[0].id}/validacao`)
      .set('Authorization', adminToken)
      .send({ ...aprovacao, crm: '888888' })
      .expect(403)
    await database.query(
      'UPDATE medicos SET deleted_at = now() WHERE id = $1',
      [medicoId],
    )
    await decidir().expect(404)
    await request(app.getHttpServer())
      .patch('/usuarios/me')
      .set('Authorization', medicoToken)
      .send({ crm: '777777' })
      .expect(404)
  })
})
