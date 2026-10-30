import { PGlite } from '@electric-sql/pglite'
import type { INestApplication } from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'
import { Test } from '@nestjs/testing'
import { drizzle } from 'drizzle-orm/pglite'
import { readFile, readdir } from 'node:fs/promises'
import request from 'supertest'
import { AppModule } from '../src/app.module.ts'
import { DRIZZLE_DB } from '../src/db/db.provider.ts'

describe('Presença do médico (GET /presenca e /presenca/historico, #50)', () => {
  let app: INestApplication
  let database: PGlite
  let medico1Token: string
  let medico2Token: string
  let gestorToken: string
  let alocacaoMedico1: string
  let alocacaoMedico2: string

  function statusDaAlocacao(alocacaoId: string, token: string) {
    return request(app.getHttpServer())
      .get(`/presenca?alocacao_id=${alocacaoId}`)
      .set('Authorization', token)
  }

  function historico(query = '', token: string) {
    return request(app.getHttpServer())
      .get(`/presenca/historico${query}`)
      .set('Authorization', token)
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
      `TRUNCATE notificacoes, pagamentos, registros_ponto, alocacoes, candidaturas, plantoes,
       gestores_instituicoes, gestores, instituicoes, medicos,
       tokens_recuperacao_senha, usuarios CASCADE`,
    )

    const usuarios = (
      await database.query<{ id: string; nome: string }>(
        `INSERT INTO usuarios (nome, email, senha_hash, tipo) VALUES
          ('Médico Um', 'medico1@example.com', 'hash', 'MEDICO'),
          ('Médico Dois', 'medico2@example.com', 'hash', 'MEDICO'),
          ('Gestor Um', 'gestor1@example.com', 'hash', 'GESTOR')
         RETURNING id, nome`,
      )
    ).rows
    const usuario = (nome: string) => usuarios.find((u) => u.nome === nome)!
    const gestor1 = usuario('Gestor Um')

    const medicos = (
      await database.query<{ id: string; crm: string }>(
        `INSERT INTO medicos (usuario_id, crm, uf_crm, especialidade)
           SELECT id, '123456', 'DF', 'Clínica Médica' FROM usuarios WHERE nome = 'Médico Um'
         UNION ALL
           SELECT id, '654321', 'SP', 'Clínica Médica' FROM usuarios WHERE nome = 'Médico Dois'
         RETURNING id, crm`,
      )
    ).rows
    const medico1Id = medicos.find((m) => m.crm === '123456')!.id
    const medico2Id = medicos.find((m) => m.crm === '654321')!.id

    await database.query(
      "INSERT INTO gestores (usuario_id) SELECT id FROM usuarios WHERE nome = 'Gestor Um'",
    )
    const [instituicao] = (
      await database.query<{ id: string }>(
        'INSERT INTO instituicoes (usuario_id, nome, cnpj, cidade, uf) VALUES ($1, $2, $3, $4, $5) RETURNING id',
        [gestor1.id, 'Hospital Ponto', '22222222000122', 'Brasília', 'DF'],
      )
    ).rows

    const criarAlocacao = async (medicoId: string) => {
      const [plantao] = (
        await database.query<{ id: string }>(
          `INSERT INTO plantoes (instituicao_id, gestor_criador_id, titulo, local_unidade,
            especialidade, data_inicio, data_fim, valor, quantidade_vagas,
            vagas_disponiveis, status)
           VALUES ($1, $2, 'Plantão Ponto', 'Home Care', 'Clínica Médica',
             '2026-10-20T10:00:00Z', '2026-10-20T18:00:00Z', '700.00', 1, 1, 'PREENCHIDO')
           RETURNING id`,
          [instituicao.id, gestor1.id],
        )
      ).rows
      const [candidatura] = (
        await database.query<{ id: string }>(
          "INSERT INTO candidaturas (plantao_id, medico_id, status) VALUES ($1, $2, 'APROVADA') RETURNING id",
          [plantao.id, medicoId],
        )
      ).rows
      const [alocacao] = (
        await database.query<{ id: string }>(
          'INSERT INTO alocacoes (plantao_id, medico_id, candidatura_id) VALUES ($1, $2, $3) RETURNING id',
          [plantao.id, medicoId, candidatura.id],
        )
      ).rows
      return alocacao.id
    }

    alocacaoMedico1 = await criarAlocacao(medico1Id)
    alocacaoMedico2 = await criarAlocacao(medico2Id)

    await database.query(
      `INSERT INTO registros_ponto (alocacao_id, tipo_evento, timestamp_servidor, latitude, longitude, precisao_metros)
       VALUES ($1, 'ENTRADA', '2026-10-20T10:05:00Z', -15.7942, -47.8822, 12.5),
              ($1, 'SAIDA', '2026-10-20T18:02:00Z', null, null, null)`,
      [alocacaoMedico1],
    )

    const jwt = app.get(JwtService)
    medico1Token = `Bearer ${await jwt.signAsync({ sub: usuario('Médico Um').id })}`
    medico2Token = `Bearer ${await jwt.signAsync({ sub: usuario('Médico Dois').id })}`
    gestorToken = `Bearer ${await jwt.signAsync({ sub: gestor1.id })}`
  })

  afterAll(async () => {
    await app?.close()
    await database?.close()
  })

  it('exige autenticação (401) e perfil de médico (403)', async () => {
    await request(app.getHttpServer())
      .get('/presenca/historico')
      .expect(401)
    await statusDaAlocacao(alocacaoMedico1, medico1Token).expect(200)
    await statusDaAlocacao(alocacaoMedico1, gestorToken).expect(403)
  })

  it('status da alocação traz plantão, instituição e os dois eventos', async () => {
    const resposta = await statusDaAlocacao(alocacaoMedico1, medico1Token).expect(200)
    expect(resposta.body.alocacao).toMatchObject({
      id: alocacaoMedico1,
      plantao: {
        titulo: 'Plantão Ponto',
        local_unidade: 'Home Care',
      },
      instituicao: { nome: 'Hospital Ponto', cidade: 'Brasília', uf: 'DF' },
    })
    const eventos = resposta.body.registros.map(
      (r: { tipo_evento: string }) => r.tipo_evento,
    )
    expect(eventos).toContain('ENTRADA')
    expect(eventos).toContain('SAIDA')
    expect(eventos).toHaveLength(2)
  })

  it('registros não expõem coordenadas, apenas com_localizacao', async () => {
    const resposta = await statusDaAlocacao(alocacaoMedico1, medico1Token).expect(200)
    const registros = resposta.body.registros as Array<Record<string, unknown>>
    const entrada = registros.find((r) => r.tipo_evento === 'ENTRADA')!
    const saida = registros.find((r) => r.tipo_evento === 'SAIDA')!
    expect(entrada).toMatchObject({ com_localizacao: true })
    expect(saida).toMatchObject({ com_localizacao: false })
    for (const registro of registros) {
      expect(Object.keys(registro)).not.toContain('latitude')
      expect(Object.keys(registro)).not.toContain('longitude')
      expect(Object.keys(registro)).not.toContain('precisao_metros')
    }
  })

  it('isolamento: alocação de outro médico e inexistente viram 404', async () => {
    await statusDaAlocacao(alocacaoMedico2, medico1Token).expect(404)
    await statusDaAlocacao('11111111-1111-4111-8111-111111111111', medico1Token).expect(404)
  })

  it('alocacao_id inválido retorna 400', async () => {
    await request(app.getHttpServer())
      .get('/presenca?alocacao_id=nao-uuid')
      .set('Authorization', medico1Token)
      .expect(400)
  })

  it('histórico é cronológico decrescente, paginado e isolado', async () => {
    await database.query(
      `INSERT INTO registros_ponto (alocacao_id, tipo_evento, timestamp_servidor, latitude, longitude)
       VALUES ($1, 'ENTRADA', '2026-10-19T08:00:00Z', null, null)`,
      [alocacaoMedico2],
    )

    const resposta = await historico('?limit=10&offset=0', medico1Token).expect(200)
    const timestamps = resposta.body.map(
      (r: { timestamp_servidor: string }) => r.timestamp_servidor,
    )
    expect(timestamps).toHaveLength(2)
    expect(new Date(timestamps[0]).getTime()).toBeGreaterThanOrEqual(
      new Date(timestamps[1]).getTime(),
    )
    expect(resposta.body[0]).toMatchObject({
      tipo_evento: 'SAIDA',
      alocacao_id: alocacaoMedico1,
      plantao: { titulo: 'Plantão Ponto' },
      instituicao: { nome: 'Hospital Ponto' },
    })
    expect(Object.keys(resposta.body[0])).not.toContain('latitude')

    const pagina2 = await historico('?limit=1&offset=1', medico1Token).expect(200)
    expect((pagina2.body as Array<{ tipo_evento: string }>)[0].tipo_evento).toBe('ENTRADA')

    const doMedico2 = await historico('', medico2Token).expect(200)
    expect(
      doMedico2.body as Array<{ alocacao_id: string }>,
    ).toHaveLength(1)
    expect((doMedico2.body as Array<{ alocacao_id: string }>)[0].alocacao_id).toBe(
      alocacaoMedico2,
    )
  })

  it('médico sem registros recebe lista vazia (empty state)', async () => {
    await database.query('DELETE FROM registros_ponto')
    const resposta = await historico('', medico1Token).expect(200)
    expect(resposta.body).toEqual([])
  })
})
