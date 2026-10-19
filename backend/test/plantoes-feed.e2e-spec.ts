import { PGlite } from '@electric-sql/pglite'
import type { INestApplication } from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'
import { Test } from '@nestjs/testing'
import { drizzle } from 'drizzle-orm/pglite'
import { readFile, readdir } from 'node:fs/promises'
import request from 'supertest'
import { AppModule } from '../src/app.module.js'
import { DRIZZLE_DB } from '../src/db/db.provider.js'

function timestamp(dias: number): string {
  return new Date(Date.now() + dias * 86_400_000).toISOString().slice(0, 23)
}

describe('Feed de plantões do médico', () => {
  let app: INestApplication
  let database: PGlite
  let gestorUsuarioId: string
  let medicoId: string
  let medicoToken: string
  let gestorToken: string
  let adminToken: string
  let instituicaoDf: string
  let instituicaoSaoPaulo: string
  let plantaoPediatria: string
  let plantaoClinica: string
  const excluidos: string[] = []

  async function criarPlantao(params: {
    instituicaoId: string
    titulo: string
    especialidade?: string
    valor?: string
    inicioDias?: number
    inicio?: string
    fim?: string
    status?: string
    permiteCandidatura?: boolean
    vagasDisponiveis?: number
    excluido?: boolean
  }): Promise<string> {
    const inicio = params.inicio ?? timestamp(params.inicioDias ?? 1)
    const fim = params.fim ?? timestamp((params.inicioDias ?? 1) + 0.5)
    const result = await database.query<{ id: string }>(
      `INSERT INTO plantoes (instituicao_id, gestor_criador_id, titulo, local_unidade, especialidade,
        data_inicio, data_fim, valor, quantidade_vagas, vagas_disponiveis, status,
        permite_candidatura, deleted_at)
       VALUES ($1, $2, $3, 'UTI', $4, $5, $6, $7, 2, $8, $9, $10, $11)
       RETURNING id`,
      [
        params.instituicaoId,
        gestorUsuarioId,
        params.titulo,
        params.especialidade ?? 'Clínica Médica',
        inicio,
        fim,
        params.valor ?? '1000.00',
        params.vagasDisponiveis ?? 2,
        params.status ?? 'ABERTO',
        params.permiteCandidatura ?? true,
        params.excluido ? timestamp(0) : null,
      ],
    )
    return result.rows[0].id
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
      .compile()
    app = module.createNestApplication()
    await app.init()
  }, 30000)

  beforeEach(async () => {
    await database.exec(
      `TRUNCATE pagamentos, registros_ponto, alocacoes, candidaturas, plantoes,
       gestores_instituicoes, gestores, instituicoes, medicos,
       tokens_recuperacao_senha, usuarios CASCADE`,
    )

    async function criarUsuario(email: string, tipo: string): Promise<string> {
      const result = await database.query<{ id: string }>(
        'INSERT INTO usuarios (nome, email, senha_hash, tipo) VALUES ($1, $2, $3, $4) RETURNING id',
        [tipo, email, 'hash', tipo],
      )
      return result.rows[0].id
    }

    const medicoUsuarioId = await criarUsuario('medico@example.com', 'MEDICO')
    gestorUsuarioId = await criarUsuario('gestor@example.com', 'GESTOR')
    const adminUsuarioId = await criarUsuario('admin@example.com', 'ADMIN')

    const medico = await database.query<{ id: string }>(
      "INSERT INTO medicos (usuario_id, crm, uf_crm) VALUES ($1, '123456', 'DF') RETURNING id",
      [medicoUsuarioId],
    )
    medicoId = medico.rows[0].id

    async function criarInstituicao(
      nome: string,
      cidade: string,
      uf: string,
      cnpj: string,
      ativa = true,
    ): Promise<string> {
      const result = await database.query<{ id: string }>(
        'INSERT INTO instituicoes (usuario_id, nome, cnpj, cidade, uf, ativa) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id',
        [gestorUsuarioId, nome, cnpj, cidade, uf, ativa],
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
    const instituicaoInativa = await criarInstituicao(
      'Hospital Fechado',
      'Brasília',
      'DF',
      '33333333000133',
      false,
    )

    plantaoPediatria = await criarPlantao({
      instituicaoId: instituicaoDf,
      titulo: 'Pediatria diurno',
      especialidade: 'Pediatria',
      valor: '1000.00',
      inicioDias: 1,
    })
    plantaoClinica = await criarPlantao({
      instituicaoId: instituicaoSaoPaulo,
      titulo: 'Clínica médica noturno',
      especialidade: 'Clínica Médica',
      valor: '2000.00',
      inicioDias: 2,
    })

    excluidos.length = 0
    excluidos.push(
      await criarPlantao({
        instituicaoId: instituicaoDf,
        titulo: 'Sem candidatura',
        permiteCandidatura: false,
      }),
      await criarPlantao({
        instituicaoId: instituicaoDf,
        titulo: 'Preenchido',
        status: 'PREENCHIDO',
      }),
      await criarPlantao({
        instituicaoId: instituicaoDf,
        titulo: 'Sem vagas',
        vagasDisponiveis: 0,
      }),
      await criarPlantao({
        instituicaoId: instituicaoDf,
        titulo: 'Excluído',
        excluido: true,
      }),
      await criarPlantao({
        instituicaoId: instituicaoInativa,
        titulo: 'Instituição inativa',
      }),
      await criarPlantao({
        instituicaoId: instituicaoDf,
        titulo: 'Já encerrado',
        inicioDias: -2,
      }),
    )
    const plantaoJaCandidatado = await criarPlantao({
      instituicaoId: instituicaoDf,
      titulo: 'Já me candidatei',
    })
    await database.query(
      'INSERT INTO candidaturas (plantao_id, medico_id) VALUES ($1, $2)',
      [plantaoJaCandidatado, medicoId],
    )
    excluidos.push(plantaoJaCandidatado)

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

  it('lista só vagas elegíveis, na ordem de início', async () => {
    const response = await listar().expect(200)
    expect(response.body.map((p: { id: string }) => p.id)).toEqual([
      plantaoPediatria,
      plantaoClinica,
    ])
    for (const id of excluidos) {
      expect(response.body).not.toContainEqual(expect.objectContaining({ id }))
    }
  })

  it('devolve os dados da instituição aninhados', async () => {
    const response = await listar().expect(200)
    expect(response.body[0]).toMatchObject({
      id: plantaoPediatria,
      local_unidade: 'UTI',
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

  it('desempata por id quando dois plantões têm o mesmo horário', async () => {
    const mesmoInicio = timestamp(3)
    const mesmoFim = timestamp(3.5)
    const primeiro = await criarPlantao({
      instituicaoId: instituicaoDf,
      titulo: 'Mesmo horário A',
      inicio: mesmoInicio,
      fim: mesmoFim,
    })
    const segundo = await criarPlantao({
      instituicaoId: instituicaoDf,
      titulo: 'Mesmo horário B',
      inicio: mesmoInicio,
      fim: mesmoFim,
    })

    const response = await listar().expect(200)
    const ultimos = response.body.slice(-2).map((p: { id: string }) => p.id)
    expect(ultimos).toEqual([primeiro, segundo].sort())
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

  it('filtra por faixa de valor e aceita faixa vazia', async () => {
    const acima = await listar({ valor_min: '1500' }).expect(200)
    expect(acima.body.map((p: { id: string }) => p.id)).toEqual([
      plantaoClinica,
    ])
    const abaixo = await listar({ valor_max: '1500' }).expect(200)
    expect(abaixo.body.map((p: { id: string }) => p.id)).toEqual([
      plantaoPediatria,
    ])
    const vazios = await listar({ valor_min: '', valor_max: '' }).expect(200)
    expect(vazios.body).toHaveLength(2)
  })

  it('limita e pagina a lista', async () => {
    const primeira = await listar({ limit: '1' }).expect(200)
    expect(primeira.body.map((p: { id: string }) => p.id)).toEqual([
      plantaoPediatria,
    ])
    const segunda = await listar({ limit: '1', offset: '1' }).expect(200)
    expect(segunda.body.map((p: { id: string }) => p.id)).toEqual([
      plantaoClinica,
    ])
  })

  it('aceita o status aberto do contrato', async () => {
    const response = await listar({ status: 'Aberto' }).expect(200)
    expect(response.body).toHaveLength(2)
  })

  it('rejeita filtros inválidos', async () => {
    await listar({ uf: 'XX' }).expect(400)
    await listar({ valor_min: '2000', valor_max: '1000' }).expect(400)
    await listar({ status: 'PREENCHIDO' }).expect(400)
    await listar({ limit: '0' }).expect(400)
    await listar({ limit: '51' }).expect(400)
    await listar({ desconhecido: '1' }).expect(400)
  })
})
