import { PGlite } from '@electric-sql/pglite'
import type { INestApplication } from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'
import { vi } from 'vitest'
import { Test } from '@nestjs/testing'
import { drizzle } from 'drizzle-orm/pglite'
import { readFile, readdir } from 'node:fs/promises'
import request from 'supertest'
import { AppModule } from '../src/app.module.ts'
import { DRIZZLE_DB } from '../src/db/db.provider.ts'

describe('Financeiro do médico (GET /financeiro/medico, #18)', () => {
  let app: INestApplication
  let database: PGlite
  let medico1Token: string
  let medico2Token: string
  let gestorToken: string

  function consultar(token: string) {
    return request(app.getHttpServer())
      .get('/financeiro/medico')
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
        [gestor1.id, 'Hospital Financeiro', '33333333000133', 'Brasília', 'DF'],
      )
    ).rows

    const criarPagamento = async (params: {
      medicoId: string
      dataPlantao: string
      status: string
      vencimentoEm?: string
      pagoEm?: string
    }) => {
      const [plantao] = (
        await database.query<{ id: string }>(
          `INSERT INTO plantoes (instituicao_id, gestor_criador_id, titulo, local_unidade,
            especialidade, data_inicio, data_fim, valor, quantidade_vagas,
            vagas_disponiveis, status)
           VALUES ($1, $2, 'Plantão Financeiro', 'Home Care', 'Clínica Médica',
             $3, $4, '100.00', 1, 1, 'PREENCHIDO')
           RETURNING id`,
          [
            instituicao.id,
            gestor1.id,
            params.dataPlantao,
            new Date(new Date(params.dataPlantao).getTime() + 8 * 3_600_000).toISOString(),
          ],
        )
      ).rows
      const [candidatura] = (
        await database.query<{ id: string }>(
          "INSERT INTO candidaturas (plantao_id, medico_id, status) VALUES ($1, $2, 'APROVADA') RETURNING id",
          [plantao.id, params.medicoId],
        )
      ).rows
      const [alocacao] = (
        await database.query<{ id: string }>(
          'INSERT INTO alocacoes (plantao_id, medico_id, candidatura_id) VALUES ($1, $2, $3) RETURNING id',
          [plantao.id, params.medicoId, candidatura.id],
        )
      ).rows
      await database.query(
        `INSERT INTO pagamentos (alocacao_id, valor, status, vencimento_em, pago_at)
         VALUES ($1, '100.00', $2, $3, $4)`,
        [alocacao.id, params.status, params.vencimentoEm ?? null, params.pagoEm ?? null],
      )
    }

    await criarPagamento({
      medicoId: medico1Id,
      dataPlantao: '2026-09-10T10:00:00Z',
      status: 'PAGO',
      pagoEm: '2026-09-15T12:00:00Z',
    })
    await criarPagamento({
      medicoId: medico1Id,
      dataPlantao: '2026-10-10T10:00:00Z',
      status: 'PENDENTE',
      vencimentoEm: '2027-01-01T00:00:00Z',
    })
    await criarPagamento({
      medicoId: medico1Id,
      dataPlantao: '2026-08-10T10:00:00Z',
      status: 'PENDENTE',
      vencimentoEm: '2026-01-01T00:00:00Z',
    })
    await criarPagamento({
      medicoId: medico2Id,
      dataPlantao: '2026-10-12T10:00:00Z',
      status: 'PENDENTE',
      vencimentoEm: '2027-02-01T00:00:00Z',
    })

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
    await request(app.getHttpServer()).get('/financeiro/medico').expect(401)
    await consultar(gestorToken).expect(403)
    await consultar(medico1Token).expect(200)
  })

  it('resumo separa recebido, a receber (no prazo) e pendente (vencido)', async () => {
    const resposta = await consultar(medico1Token).expect(200)
    expect(resposta.body.resumo).toEqual({
      total_recebido: '100.00',
      total_a_receber: '100.00',
      total_pendente: '100.00',
    })
  })

  it('lista traz plantão, instituição, valor e status, sem float', async () => {
    const resposta = await consultar(medico1Token).expect(200)
    const pagamentos = resposta.body.pagamentos as Array<{
      valor: string
      status: string
      plantao: { titulo: string }
      instituicao: { nome: string }
    }>
    expect(pagamentos).toHaveLength(3)
    for (const pagamento of pagamentos) {
      expect(typeof pagamento.valor).toBe('string')
      expect(pagamento.plantao.titulo).toBe('Plantão Financeiro')
      expect(pagamento.instituicao.nome).toBe('Hospital Financeiro')
      expect(['PENDENTE', 'PAGO']).toContain(pagamento.status)
    }
  })

  it('totais conferem com a soma da lista', async () => {
    const resposta = await consultar(medico1Token).expect(200)
    const soma = (resposta.body.pagamentos as Array<{ valor: string; status: string }>)
      .filter((p) => p.status === 'PAGO')
      .reduce((acc, p) => acc + Number(p.valor), 0)
    expect(Number(resposta.body.resumo.total_recebido)).toBe(soma)
  })

  it('lê resumo e lista em uma transação REPEATABLE READ (mesmo snapshot)', async () => {
    const db = app.get<{ transaction: (...args: unknown[]) => unknown }>(
      DRIZZLE_DB,
    )
    const espiao = vi.spyOn(db, 'transaction')

    await consultar(medico1Token).expect(200)

    expect(espiao).toHaveBeenCalledTimes(1)
    expect(espiao.mock.calls[0][1]).toMatchObject({
      isolationLevel: 'repeatable read',
    })
    espiao.mockRestore()
  })

  it('isolamento: médico só vê os próprios pagamentos', async () => {
    const doMedico1 = await consultar(medico1Token).expect(200)
    const doMedico2 = await consultar(medico2Token).expect(200)
    expect((doMedico1.body.pagamentos as unknown[])).toHaveLength(3)
    expect((doMedico2.body.pagamentos as unknown[])).toHaveLength(1)
    expect(doMedico2.body.resumo).toEqual({
      total_recebido: '0',
      total_a_receber: '100.00',
      total_pendente: '0',
    })
  })

  it('médico sem pagamentos recebe resumo zerado e lista vazia', async () => {
    await database.query('DELETE FROM pagamentos')
    const resposta = await consultar(medico1Token).expect(200)
    expect(resposta.body.resumo).toEqual({
      total_recebido: '0',
      total_a_receber: '0',
      total_pendente: '0',
    })
    expect(resposta.body.pagamentos).toEqual([])
  })
})
