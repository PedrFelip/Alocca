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

  it('não mistura dados de outra instituição mesmo havendo vínculo com a primeira', async () => {
    await vincularGestor()
    const [outra] = (
      await database.query<{ id: string }>(`
      INSERT INTO instituicoes (usuario_id, nome, cnpj)
      SELECT usuario_id, 'Outra instituição', '33333333000133' FROM instituicoes LIMIT 1
      RETURNING id`)
    ).rows
    await database.query(
      `UPDATE plantoes SET instituicao_id = $1
      WHERE id = (SELECT plantao_id FROM alocacoes WHERE id = $2)`,
      [outra.id, alocacaoMedico2],
    )
    await database.query(
      `INSERT INTO registros_ponto (alocacao_id, tipo_evento)
      VALUES ($1, 'ENTRADA')`,
      [alocacaoMedico2],
    )
    const medicos = await request(app.getHttpServer())
      .get('/gestor/medicos')
      .set('Authorization', gestorToken)
      .expect(200)
    expect(medicos.body).toHaveLength(1)
    expect(medicos.body[0].nome).toBe('Médico Um')
    const ponto = await request(app.getHttpServer())
      .get('/gestor/ponto')
      .set('Authorization', gestorToken)
      .expect(200)
    expect(ponto.body).toHaveLength(2)
    expect(
      ponto.body.every(
        (item: { medico: { nome: string } }) =>
          item.medico.nome === 'Médico Um',
      ),
    ).toBe(true)
  })

  async function vincularGestor() {
    await database.exec(`INSERT INTO gestores_instituicoes (gestor_id, instituicao_id)
      SELECT g.id, i.id FROM gestores g CROSS JOIN instituicoes i`)
  }

  it('consultas do gestor exigem autenticação, papel e paginação válida', async () => {
    for (const recurso of ['medicos', 'ponto']) {
      await request(app.getHttpServer()).get(`/gestor/${recurso}`).expect(401)
      await request(app.getHttpServer())
        .get(`/gestor/${recurso}`)
        .set('Authorization', medico1Token)
        .expect(403)
      await request(app.getHttpServer())
        .get(`/gestor/${recurso}?limit=51`)
        .set('Authorization', gestorToken)
        .expect(400)
    }
  })

  it('gestor só consulta médicos e ponto de instituições vinculadas', async () => {
    for (const recurso of ['medicos', 'ponto']) {
      const vazia = await request(app.getHttpServer())
        .get(`/gestor/${recurso}`)
        .set('Authorization', gestorToken)
        .expect(200)
      expect(vazia.body).toEqual([])
    }
    await vincularGestor()
    const medicos = await request(app.getHttpServer())
      .get('/gestor/medicos')
      .set('Authorization', gestorToken)
      .expect(200)
    expect(medicos.body).toHaveLength(2)
    expect(medicos.body[0]).toMatchObject({
      nome: 'Médico Dois',
      crm: '654321',
      uf_crm: 'SP',
    })
    expect(medicos.body[0]).not.toHaveProperty('senha_hash')
    expect(medicos.body[0]).not.toHaveProperty('cpf')
    const ponto = await request(app.getHttpServer())
      .get('/gestor/ponto?limit=1&offset=1')
      .set('Authorization', gestorToken)
      .expect(200)
    expect(ponto.body).toHaveLength(1)
    expect(ponto.body[0]).toMatchObject({
      tipo_evento: 'ENTRADA',
      com_localizacao: true,
      medico: { nome: 'Médico Um' },
    })
    expect(ponto.body[0]).not.toHaveProperty('latitude')
    expect(ponto.body[0]).not.toHaveProperty('longitude')
    await database.exec('UPDATE instituicoes SET ativa = false')
    for (const recurso of ['medicos', 'ponto']) {
      const resposta = await request(app.getHttpServer())
        .get(`/gestor/${recurso}`)
        .set('Authorization', gestorToken)
        .expect(200)
      expect(resposta.body).toEqual([])
    }
  })

  it('paginação de médicos é estável e alocações excluídas não aparecem', async () => {
    await vincularGestor()
    const todos = await request(app.getHttpServer())
      .get('/gestor/medicos')
      .set('Authorization', gestorToken)
      .expect(200)
    const primeira = await request(app.getHttpServer())
      .get('/gestor/medicos?limit=1')
      .set('Authorization', gestorToken)
      .expect(200)
    const segunda = await request(app.getHttpServer())
      .get('/gestor/medicos?limit=1&offset=1')
      .set('Authorization', gestorToken)
      .expect(200)
    expect([...primeira.body, ...segunda.body]).toEqual(todos.body)
    await database.exec('UPDATE alocacoes SET deleted_at = now()')
    for (const recurso of ['medicos', 'ponto']) {
      const resposta = await request(app.getHttpServer())
        .get(`/gestor/${recurso}`)
        .set('Authorization', gestorToken)
        .expect(200)
      expect(resposta.body).toEqual([])
    }
  })

  it('aplica busca literal e filtros combinados de médicos', async () => {
    await vincularGestor()
    await database.exec(
      "UPDATE medicos SET especialidade = 'Cardio%_logia', status_validacao = 'APROVADO' WHERE crm = '123456'",
    )
    for (const query of [
      'q=mÉDICO%20UM',
      'q=1234',
      'q=cardio',
      'especialidade=%25_',
      'q=%25_',
      'status=ATIVO&status_validacao=APROVADO&uf_crm=df',
    ]) {
      const r = await request(app.getHttpServer())
        .get(`/gestor/medicos?${query}`)
        .set('Authorization', gestorToken)
        .expect(200)
      expect(r.body.map((m: { crm: string }) => m.crm)).toEqual(['123456'])
    }
    await database.exec(
      "UPDATE medicos SET especialidade = E'Cardio\\\\logia' WHERE crm = '123456'",
    )
    const barra = await request(app.getHttpServer())
      .get('/gestor/medicos?q=%5C')
      .set('Authorization', gestorToken)
      .expect(200)
    expect(barra.body).toHaveLength(1)
    const r = await request(app.getHttpServer())
      .get('/gestor/medicos?q=cardio&limit=1&offset=1')
      .set('Authorization', gestorToken)
      .expect(200)
    expect(r.body).toEqual([])
  })

  it('filtra ponto por médico, evento e intervalo semiaberto em fusos distintos', async () => {
    await vincularGestor()
    const [medico] = (
      await database.query<{ medico_id: string }>(
        'SELECT medico_id FROM alocacoes WHERE id = $1',
        [alocacaoMedico1],
      )
    ).rows
    const consultar = (query: string) =>
      request(app.getHttpServer())
        .get(`/gestor/ponto?${query}`)
        .set('Authorization', gestorToken)
        .expect(200)
    const r = await consultar(
      `medico_id=${medico.medico_id}&tipo_evento=ENTRADA&inicio=2026-10-20T07%3A05%3A00-03%3A00&fim=2026-10-20T18%3A02%3A00Z`,
    )
    expect(r.body).toHaveLength(1)
    expect(r.body[0].tipo_evento).toBe('ENTRADA')
    expect((await consultar('fim=2026-10-20T10%3A05%3A00Z')).body).toEqual([])
    const todos = await consultar('limit=2')
    expect([
      ...(await consultar('limit=1')).body,
      ...(await consultar('limit=1&offset=1')).body,
    ]).toEqual(todos.body)
  })

  it('valida filtros e restringe instituição ao escopo do gestor', async () => {
    await vincularGestor()
    const [instituicao] = (
      await database.query<{ id: string }>(
        'SELECT id FROM instituicoes LIMIT 1',
      )
    ).rows
    const [outra] = (
      await database.query<{ id: string }>(
        "INSERT INTO instituicoes (usuario_id, nome, cnpj) SELECT usuario_id, 'Outra', '33333333000133' FROM instituicoes LIMIT 1 RETURNING id",
      )
    ).rows
    for (const recurso of ['medicos', 'ponto']) {
      const fora = await request(app.getHttpServer())
        .get(`/gestor/${recurso}?instituicao_id=${outra.id}`)
        .set('Authorization', gestorToken)
        .expect(200)
      expect(fora.body).toEqual([])
      for (const [query, status] of [
        [`instituicao_id=${instituicao.id}`, 200],
        [`instituicao_id=${outra.id}`, 200],
        ['instituicao_id=x', 400],
        ['limit=0', 400],
        ['limit=51', 400],
        ['offset=-1', 400],
        ['offset=1.5', 400],
        ['desconhecido=x', 400],
      ] as const) {
        await request(app.getHttpServer())
          .get(`/gestor/${recurso}?${query}`)
          .set('Authorization', gestorToken)
          .expect(status)
      }
    }
    for (const query of [
      'status=INVALIDO',
      'status_validacao=INVALIDO',
      'uf_crm=XX',
      'q=%20',
    ]) {
      await request(app.getHttpServer())
        .get(`/gestor/medicos?${query}`)
        .set('Authorization', gestorToken)
        .expect(400)
    }
    for (const query of [
      'medico_id=x',
      'tipo_evento=INVALIDO',
      'inicio=2026-10-20T10:00:00',
      'inicio=2026-02-30T10:00:00Z',
      'inicio=2026-10-20T10:00:00%2B25:00',
      'fim=2026-13-01T10:00:00Z',
      'inicio=2026-10-20T10:00:00Z&fim=2026-10-20T10:00:00Z',
      'inicio=2026-10-21T10:00:00Z&fim=2026-10-20T10:00:00Z',
    ]) {
      await request(app.getHttpServer())
        .get(`/gestor/ponto?${query}`)
        .set('Authorization', gestorToken)
        .expect(400)
    }
  })

  afterAll(async () => {
    await app?.close()
    await database?.close()
  })

  it('exige autenticação (401) e perfil de médico (403)', async () => {
    await request(app.getHttpServer()).get('/presenca/historico').expect(401)
    await statusDaAlocacao(alocacaoMedico1, medico1Token).expect(200)
    await statusDaAlocacao(alocacaoMedico1, gestorToken).expect(403)
  })

  it('status da alocação traz plantão, instituição e os dois eventos', async () => {
    const resposta = await statusDaAlocacao(
      alocacaoMedico1,
      medico1Token,
    ).expect(200)
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
    const resposta = await statusDaAlocacao(
      alocacaoMedico1,
      medico1Token,
    ).expect(200)
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
    await statusDaAlocacao(
      '11111111-1111-4111-8111-111111111111',
      medico1Token,
    ).expect(404)
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

    const resposta = await historico('?limit=10&offset=0', medico1Token).expect(
      200,
    )
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

    const pagina2 = await historico('?limit=1&offset=1', medico1Token).expect(
      200,
    )
    expect(
      (pagina2.body as Array<{ tipo_evento: string }>)[0].tipo_evento,
    ).toBe('ENTRADA')

    const doMedico2 = await historico('', medico2Token).expect(200)
    expect(doMedico2.body as Array<{ alocacao_id: string }>).toHaveLength(1)
    expect(
      (doMedico2.body as Array<{ alocacao_id: string }>)[0].alocacao_id,
    ).toBe(alocacaoMedico2)
  })

  it('histórico pagina sem repetir nem omitir registros com timestamp igual', async () => {
    await database.query(
      "UPDATE registros_ponto SET timestamp_servidor = '2026-10-19T08:00:00Z' WHERE alocacao_id = $1",
      [alocacaoMedico1],
    )

    const todos = await historico('?limit=10&offset=0', medico1Token).expect(
      200,
    )
    const pagina1 = await historico('?limit=1&offset=0', medico1Token).expect(
      200,
    )
    const pagina2 = await historico('?limit=1&offset=1', medico1Token).expect(
      200,
    )

    const ids = (corpo: Array<{ id: string }>) => corpo.map((r) => r.id)
    expect(ids(todos.body)).toHaveLength(2)
    expect([...ids(pagina1.body), ...ids(pagina2.body)]).toEqual(
      ids(todos.body),
    )
  })

  it('plantão ou instituição excluídos (soft delete) somem do status e do histórico', async () => {
    await historico('', medico1Token)
      .expect(200)
      .expect((r) => {
        expect(r.body.length).toBeGreaterThan(0)
      })
    await database.query('UPDATE plantoes SET deleted_at = now()')
    await statusDaAlocacao(alocacaoMedico1, medico1Token).expect(404)
    expect((await historico('', medico1Token).expect(200)).body).toEqual([])

    await database.query('UPDATE plantoes SET deleted_at = null')
    await statusDaAlocacao(alocacaoMedico1, medico1Token).expect(200)
    await database.query('UPDATE instituicoes SET deleted_at = now()')
    await statusDaAlocacao(alocacaoMedico1, medico1Token).expect(404)
    expect((await historico('', medico1Token).expect(200)).body).toEqual([])
  })

  it('médico sem registros recebe lista vazia (empty state)', async () => {
    await database.query('DELETE FROM registros_ponto')
    const resposta = await historico('', medico1Token).expect(200)
    expect(resposta.body).toEqual([])
  })
})
