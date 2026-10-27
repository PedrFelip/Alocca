import { PGlite } from '@electric-sql/pglite'
import type { INestApplication } from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'
import { Test } from '@nestjs/testing'
import { drizzle } from 'drizzle-orm/pglite'
import { readFile, readdir } from 'node:fs/promises'
import request from 'supertest'
import { AppModule } from '../src/app.module.ts'
import { DRIZZLE_DB } from '../src/db/db.provider.ts'

describe('Agenda mensal (GET /agenda/mes, #16)', () => {
  let app: INestApplication
  let database: PGlite
  let medico1Token: string
  let medico2Token: string
  let gestorToken: string
  let adminToken: string

  function consultar(ano: number, mes: number, token: string) {
    return request(app.getHttpServer())
      .get(`/agenda/mes?ano=${ano}&mes=${mes}`)
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
          ('Gestor Um', 'gestor1@example.com', 'hash', 'GESTOR'),
          ('Admin', 'admin@example.com', 'hash', 'ADMIN')
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
    await database.query("INSERT INTO gestores (usuario_id) SELECT id FROM usuarios WHERE nome = 'Gestor Um'")

    const criadoEmNovembro = new Date('2026-11-01T00:00:00Z')
    await database.query(
      `INSERT INTO instituicoes (id, usuario_id, nome, nome_fantasia, cnpj, cidade, uf)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        '11111111-1111-4111-8111-111111111111',
        gestor1.id,
        'Hospital Teste',
        'Hospital Teste Ltda',
        '11111111000111',
        'Brasília',
        'DF',
      ],
    )
    void criadoEmNovembro

    const novoPlantao = async (params: {
      titulo: string
      inicio: string
      fim: string
      status?: string
    }) => {
      const [plantao] = (
        await database.query<{ id: string }>(
          `INSERT INTO plantoes (instituicao_id, gestor_criador_id, titulo, local_unidade,
            especialidade, data_inicio, data_fim, valor, quantidade_vagas,
            vagas_disponiveis, status)
           VALUES ('11111111-1111-4111-8111-111111111111', $1, $2, 'Home Care', 'Clínica Médica', $3, $4, '800.00', 1, 1, $5)
           RETURNING id`,
          [gestor1.id, params.titulo, params.inicio, params.fim, params.status ?? 'ABERTO'],
        )
      ).rows
      return plantao.id
    }

    const medico1Id = medicos.find((m) => m.crm === '123456')!.id
    const medico2Id = medicos.find((m) => m.crm === '654321')!.id

    await novoPlantao({
      titulo: 'Candidatura Pendente',
      inicio: '2026-11-10T10:00:00',
      fim: '2026-11-10T18:00:00',
    })
    await database.query(
      "INSERT INTO candidaturas (plantao_id, medico_id, status) SELECT id, $1, 'PENDENTE' FROM plantoes WHERE titulo = 'Candidatura Pendente'",
      [medico1Id],
    )

    await novoPlantao({
      titulo: 'Confirmado Futuro',
      inicio: '2026-11-20T10:00:00',
      fim: '2026-11-20T18:00:00',
    })
    await database.query(
      "INSERT INTO candidaturas (plantao_id, medico_id, status) SELECT id, $1, 'APROVADA' FROM plantoes WHERE titulo = 'Confirmado Futuro'",
      [medico1Id],
    )
    await database.query(
      "INSERT INTO alocacoes (plantao_id, medico_id, candidatura_id) SELECT p.id, $1, c.id FROM plantoes p JOIN candidaturas c ON c.plantao_id = p.id WHERE p.titulo = 'Confirmado Futuro'",
      [medico1Id],
    )

    await novoPlantao({
      titulo: 'Passado Concluido',
      inicio: '2026-10-10T01:30:00',
      fim: '2026-10-10T09:30:00',
    })
    await database.query(
      "INSERT INTO candidaturas (plantao_id, medico_id, status) SELECT id, $1, 'APROVADA' FROM plantoes WHERE titulo = 'Passado Concluido'",
      [medico1Id],
    )
    await database.query(
      "INSERT INTO alocacoes (plantao_id, medico_id, candidatura_id) SELECT p.id, $1, c.id FROM plantoes p JOIN candidaturas c ON c.plantao_id = p.id WHERE p.titulo = 'Passado Concluido'",
      [medico1Id],
    )

    await novoPlantao({
      titulo: 'Cancelado',
      inicio: '2026-11-08T10:00:00',
      fim: '2026-11-08T18:00:00',
      status: 'CANCELADO',
    })
    await database.query(
      "INSERT INTO candidaturas (plantao_id, medico_id, status) SELECT id, $1, 'APROVADA' FROM plantoes WHERE titulo = 'Cancelado'",
      [medico1Id],
    )
    await database.query(
      "INSERT INTO alocacoes (plantao_id, medico_id, candidatura_id) SELECT p.id, $1, c.id FROM plantoes p JOIN candidaturas c ON c.plantao_id = p.id WHERE p.titulo = 'Cancelado'",
      [medico1Id],
    )

    await novoPlantao({
      titulo: 'De Outro Medico',
      inicio: '2026-11-12T10:00:00',
      fim: '2026-11-12T18:00:00',
    })
    await database.query(
      "INSERT INTO candidaturas (plantao_id, medico_id, status) SELECT id, $1, 'PENDENTE' FROM plantoes WHERE titulo = 'De Outro Medico'",
      [medico2Id],
    )

    const jwt = app.get(JwtService)
    medico1Token = `Bearer ${await jwt.signAsync({ sub: usuario('Médico Um').id })}`
    medico2Token = `Bearer ${await jwt.signAsync({ sub: usuario('Médico Dois').id })}`
    gestorToken = `Bearer ${await jwt.signAsync({ sub: gestor1.id })}`
    adminToken = `Bearer ${await jwt.signAsync({ sub: usuario('Admin').id })}`
  })

  afterAll(async () => {
    await app?.close()
    await database?.close()
  })

  it('exige autenticação (401) e perfil de médico (403)', async () => {
    await request(app.getHttpServer()).get('/agenda/mes?ano=2026&mes=11').expect(401)
    for (const token of [gestorToken, adminToken]) {
      await consultar(2026, 11, token).expect(403)
    }
  })

  it('agrupa por dia em ordem crescente com os três estados', async () => {
    const resposta = await consultar(2026, 11, medico1Token).expect(200)
    const dias = resposta.body.map((g: { dia: string }) => g.dia)
    expect(dias.length).toBeGreaterThan(0)
    expect(dias).toEqual([...dias].sort((a, b) => a.localeCompare(b)))

    const itens = resposta.body.flatMap((g: { itens: Array<Record<string, unknown>> }) => g.itens)
    const candidatura = itens.find(
      (i: { plantao: { titulo: string } }) => i.plantao.titulo === 'Candidatura Pendente',
    )!
    expect(candidatura).toMatchObject({ tipo_origem: 'CANDIDATURA', status: 'PENDENTE' })

    const confirmado = itens.find(
      (i: { plantao: { titulo: string } }) => i.plantao.titulo === 'Confirmado Futuro',
    )!
    expect(confirmado).toMatchObject({ tipo_origem: 'ALOCACAO', status: 'CONFIRMADO' })
  })

  it('plantão encerrado no mês aparece como CONCLUIDO', async () => {
    const resposta = await consultar(2026, 10, medico1Token)
    const itens = resposta.body.flatMap(
      (g: { itens: Array<Record<string, unknown>> }) => g.itens,
    )
    const passado = itens.find(
      (i: { plantao: { titulo: string } }) => i.plantao.titulo === 'Passado Concluido',
    )!
    expect(passado).toMatchObject({ tipo_origem: 'ALOCACAO', status: 'CONCLUIDO' })
  })

  it('não vaza dados de terceiros e oculta cancelados', async () => {
    for (const token of [medico1Token, medico2Token]) {
      const resposta = await consultar(2026, 11, token).expect(200)
      const titulos = resposta.body.flatMap(
        (g: { itens: Array<{ plantao: { titulo: string } }> }) =>
          g.itens.map((i) => i.plantao.titulo),
      )
      expect(titulos).not.toContain('Cancelado')
    }
    const doMedico1 = await consultar(2026, 11, medico1Token).expect(200)
    const doMedico2 = await consultar(2026, 11, medico2Token).expect(200)
    const titulos1 = JSON.stringify(doMedico1.body)
    const titulos2 = JSON.stringify(doMedico2.body)
    expect(titulos1).toContain('Candidatura Pendente')
    expect(titulos1).not.toContain('De Outro Medico')
    expect(titulos2).toContain('De Outro Medico')
    expect(titulos2).not.toContain('Candidatura Pendente')
  })

  it('payload do card traz plantão e instituição completos', async () => {
    const resposta = await respostaAgenda(2026, 11, medico1Token)
    const item = resposta.find(
      (i: { plantao: { titulo: string } }) => i.plantao.titulo === 'Confirmado Futuro',
    )!
    expect(item).toMatchObject({
      tipo_origem: 'ALOCACAO',
      plantao: {
        titulo: 'Confirmado Futuro',
        especialidade: 'Clínica Médica',
        valor: '800.00',
        local_unidade: 'Home Care',
      },
      instituicao: { nome: 'Hospital Teste', cidade: 'Brasília', uf: 'DF' },
    })
  })

  async function respostaAgenda(ano: number, mes: number, token: string) {
    const resposta = await consultar(ano, mes, token).expect(200)
    return resposta.body.flatMap(
      (g: { itens: unknown[] }) => g.itens as unknown[],
    )
  }

  it('mês inválido retorna 400', async () => {
    await request(app.getHttpServer())
      .get('/agenda/mes?ano=2026&mes=13')
      .set('Authorization', medico1Token)
      .expect(400)
  })

  it('médico sem plantões no mês recebe lista vazia', async () => {
    const resposta = await consultar(2030, 5, medico2Token).expect(200)
    expect(resposta.body).toEqual([])
  })
})
