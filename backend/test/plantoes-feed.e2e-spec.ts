import { PGlite } from '@electric-sql/pglite'
import type { INestApplication } from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'
import { Test } from '@nestjs/testing'
import { drizzle } from 'drizzle-orm/pglite'
import { readFile, readdir } from 'node:fs/promises'
import request from 'supertest'
import { AppModule } from '../src/app.module.js'
import { DRIZZLE_DB } from '../src/db/db.provider.js'

describe('Feed de plantões do médico', () => {
  let app: INestApplication
  let database: PGlite
  let medicoToken: string
  let gestorToken: string
  let adminToken: string
  let instituicaoDf: string
  let instituicaoSaoPaulo: string
  let plantaoPediatria: string
  let plantaoClinica: string
  let plantaoSemCandidatura: string
  let plantaoRascunho: string
  let plantaoSemVagas: string
  let plantaoExcluido: string

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
  }, 30000)

  beforeEach(async () => {
    await database.exec(
      `TRUNCATE pagamentos, registros_ponto, alocacoes, candidaturas, plantoes,
       gestores, instituicoes, medicos, tokens_recuperacao_senha, usuarios CASCADE`,
    )

    async function criarUsuario(email: string, tipo: string): Promise<string> {
      const result = await database.query<{ id: string }>(
        'INSERT INTO usuarios (nome, email, senha_hash, tipo) VALUES ($1, $2, $3, $4) RETURNING id',
        [tipo, email, 'hash', tipo],
      )
      return result.rows[0].id
    }

    const medicoUsuarioId = await criarUsuario('medico@example.com', 'MEDICO')
    const gestorUsuarioId = await criarUsuario('gestor@example.com', 'GESTOR')
    const adminUsuarioId = await criarUsuario('admin@example.com', 'ADMIN')

    await database.query(
      "INSERT INTO medicos (usuario_id, crm, uf_crm) VALUES ($1, '123456', 'DF')",
      [medicoUsuarioId],
    )

    async function criarInstituicao(
      nome: string,
      cidade: string,
      uf: string,
      cnpj: string,
    ): Promise<string> {
      const result = await database.query<{ id: string }>(
        'INSERT INTO instituicoes (usuario_id, nome, cnpj, cidade, uf) VALUES ($1, $2, $3, $4, $5) RETURNING id',
        [gestorUsuarioId, nome, cnpj, cidade, uf],
      )
      return result.rows[0].id
    }

    instituicaoDf = await criarInstituicao(
      'Hospital Brasília',
      'Brasília',
      'DF',
      '11111111000111',
    )
    instituicaoSaoPaulo = await criarInstituicao(
      'Hospital Paulista',
      'São Paulo',
      'SP',
      '22222222000122',
    )

    const gestor = await database.query<{ id: string }>(
      'INSERT INTO gestores (usuario_id, instituicao_id) VALUES ($1, $2) RETURNING id',
      [gestorUsuarioId, instituicaoDf],
    )
    const gestorId = gestor.rows[0].id

    async function criarPlantao(params: {
      instituicaoId: string
      titulo: string
      especialidade: string
      valor: string
      dataInicio?: string
      status?: string
      permiteCandidatura?: boolean
      quantidadeVagas?: number
      vagasDisponiveis?: number
      excluido?: boolean
    }): Promise<string> {
      const dataInicio = params.dataInicio ?? '1 day'
      const result = await database.query<{ id: string }>(
        `INSERT INTO plantoes (instituicao_id, criado_por_gestor_id, titulo, especialidade,
          data_inicio, data_fim, valor, quantidade_vagas, vagas_disponiveis, status,
          permite_candidatura, deleted_at)
         VALUES ($1, $2, $3, $4, now() + interval '${dataInicio}',
          now() + interval '${dataInicio}' + interval '12 hours', $5, $6, $7, $8, $9,
          ${params.excluido ? 'now()' : 'NULL'})
         RETURNING id`,
        [
          params.instituicaoId,
          gestorId,
          params.titulo,
          params.especialidade,
          params.valor,
          params.quantidadeVagas ?? 2,
          params.vagasDisponiveis ?? 2,
          params.status ?? 'ABERTO',
          params.permiteCandidatura ?? true,
        ],
      )
      return result.rows[0].id
    }

    plantaoPediatria = await criarPlantao({
      instituicaoId: instituicaoDf,
      titulo: 'Pediatria diurno',
      especialidade: 'Pediatria',
      valor: '1000.00',
    })
    plantaoClinica = await criarPlantao({
      instituicaoId: instituicaoSaoPaulo,
      titulo: 'Clínica médica noturno',
      especialidade: 'Clínica Médica',
      valor: '2000.00',
      dataInicio: '2 days',
    })
    plantaoSemCandidatura = await criarPlantao({
      instituicaoId: instituicaoDf,
      titulo: 'Fechado para candidatura',
      especialidade: 'Pediatria',
      valor: '1000.00',
      permiteCandidatura: false,
    })
    plantaoRascunho = await criarPlantao({
      instituicaoId: instituicaoDf,
      titulo: 'Rascunho',
      especialidade: 'Pediatria',
      valor: '1000.00',
      status: 'RASCUNHO',
    })
    plantaoSemVagas = await criarPlantao({
      instituicaoId: instituicaoDf,
      titulo: 'Sem vagas',
      especialidade: 'Pediatria',
      valor: '1000.00',
      vagasDisponiveis: 0,
    })
    plantaoExcluido = await criarPlantao({
      instituicaoId: instituicaoDf,
      titulo: 'Excluído',
      especialidade: 'Pediatria',
      valor: '1000.00',
      excluido: true,
    })

    const jwt = app.get(JwtService)
    medicoToken = `Bearer ${await jwt.signAsync({ sub: medicoUsuarioId })}`
    gestorToken = `Bearer ${await jwt.signAsync({ sub: gestorUsuarioId })}`
    adminToken = `Bearer ${await jwt.signAsync({ sub: adminUsuarioId })}`
  })

  afterAll(async () => {
    await app?.close()
    await database?.close()
  })

  function listar(query: Record<string, string> = {}) {
    return request(app.getHttpServer())
      .get('/plantoes')
      .set('Authorization', medicoToken)
      .query(query)
  }

  it('exige autenticação e perfil de médico', async () => {
    await request(app.getHttpServer()).get('/plantoes').expect(401)
    for (const token of [gestorToken, adminToken]) {
      await request(app.getHttpServer())
        .get('/plantoes')
        .set('Authorization', token)
        .expect(403)
    }
  })

  it('lista só vagas abertas, com candidatura e vagas disponíveis', async () => {
    const response = await listar().expect(200)
    expect(response.body.map((p: { id: string }) => p.id)).toEqual([
      plantaoPediatria,
      plantaoClinica,
    ])
    expect(response.body).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: plantaoSemCandidatura }),
        expect.objectContaining({ id: plantaoRascunho }),
        expect.objectContaining({ id: plantaoSemVagas }),
        expect.objectContaining({ id: plantaoExcluido }),
      ]),
    )
  })

  it('devolve os dados da instituição aninhados', async () => {
    const response = await listar().expect(200)
    expect(response.body[0]).toMatchObject({
      id: plantaoPediatria,
      especialidade: 'Pediatria',
      valor: '1000.00',
      vagas_disponiveis: 2,
      instituicao: {
        id: instituicaoDf,
        nome: 'Hospital Brasília',
        cidade: 'Brasília',
        uf: 'DF',
      },
    })
  })

  it('filtra por especialidade sem diferenciar maiúsculas', async () => {
    const response = await listar({ especialidade: 'pediatr' }).expect(200)
    expect(response.body.map((p: { id: string }) => p.id)).toEqual([
      plantaoPediatria,
    ])
  })

  it('filtra por cidade e UF', async () => {
    const porCidade = await listar({ cidade: 'são' }).expect(200)
    expect(porCidade.body.map((p: { id: string }) => p.id)).toEqual([
      plantaoClinica,
    ])
    const porUf = await listar({ uf: 'df' }).expect(200)
    expect(porUf.body.map((p: { id: string }) => p.id)).toEqual([
      plantaoPediatria,
    ])
  })

  it('filtra por faixa de valor', async () => {
    const acima = await listar({ valor_min: '1500' }).expect(200)
    expect(acima.body.map((p: { id: string }) => p.id)).toEqual([
      plantaoClinica,
    ])
    const abaixo = await listar({ valor_max: '1500' }).expect(200)
    expect(abaixo.body.map((p: { id: string }) => p.id)).toEqual([
      plantaoPediatria,
    ])
  })

  it('rejeita filtros inválidos', async () => {
    await listar({ uf: 'XX' }).expect(400)
    await listar({ valor_min: '2000', valor_max: '1000' }).expect(400)
    await listar({ status: 'RASCUNHO' }).expect(400)
    await listar({ desconhecido: '1' }).expect(400)
  })
})
