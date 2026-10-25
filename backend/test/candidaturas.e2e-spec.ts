import { PGlite } from '@electric-sql/pglite'
import type { INestApplication } from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'
import { Test } from '@nestjs/testing'
import { drizzle } from 'drizzle-orm/pglite'
import { readFile, readdir } from 'node:fs/promises'
import request from 'supertest'
import { AppModule } from '../src/app.module.ts'
import { DRIZZLE_DB } from '../src/db/db.provider.ts'

function ts(dias: number): string {
  return new Date(Date.now() + dias * 86_400_000).toISOString().slice(0, 23)
}

describe('Candidaturas (UC05) e alocação (UC11)', () => {
  let app: INestApplication
  let database: PGlite
  let medico1Token: string
  let medico2Token: string
  let gestorToken: string
  let gestorEstranhoToken: string
  let adminToken: string
  let plantaoAberto: string
  let plantaoAbertoInicio: string
  let plantaoUmaVaga: string
  let novoPlantao: (params: {
    titulo: string
    inicio: string
    fim: string
    quantidadeVagas?: number
    vagasDisponiveis?: number
    status?: string
  }) => Promise<string>

  /** Confirma alocação existente (candidatura APROVADA + alocação + pagamento). */
  async function alocarConfirmado(plantaoId: string, crm: string): Promise<void> {
    const medico = (
      await database.query<{ id: string }>(
        'SELECT id FROM medicos WHERE crm = $1',
        [crm],
      )
    ).rows[0]
    const candidatura = (
      await database.query<{ id: string }>(
        'INSERT INTO candidaturas (plantao_id, medico_id) VALUES ($1, $2) RETURNING id',
        [plantaoId, medico.id],
      )
    ).rows[0]
    await database.query(
      'INSERT INTO alocacoes (plantao_id, medico_id, candidatura_id) VALUES ($1, $2, $3)',
      [plantaoId, medico.id, candidatura.id],
    )
    await database.query(
      "UPDATE candidaturas SET status = 'APROVADA', analisado_at = now() WHERE id = $1",
      [candidatura.id],
    )
    const [plantao] = (
      await database.query<{ valor: string }>(
        'SELECT valor FROM plantoes WHERE id = $1',
        [plantaoId],
      )
    ).rows
    await database.query(
      'INSERT INTO pagamentos (alocacao_id, valor) SELECT id, $2 FROM alocacoes WHERE candidatura_id = $1',
      [candidatura.id, plantao.valor],
    )
  }

  function candidatar(plantaoId: string, token: string, corpo: object = {}) {
    return request(app.getHttpServer())
      .post(`/plantoes/${plantaoId}/candidaturas`)
      .set('Authorization', token)
      .send(corpo)
  }

  function aprovar(
    plantaoId: string,
    candidaturaId: string,
    token: string,
  ) {
    return request(app.getHttpServer())
      .post(`/plantoes/${plantaoId}/candidaturas/${candidaturaId}/aprovar`)
      .set('Authorization', token)
      .send()
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

    const usuarios = (
      await database.query<{ id: string; nome: string }>(
        `INSERT INTO usuarios (nome, email, senha_hash, tipo) VALUES
          ('Médico Um', 'medico1@example.com', 'hash', 'MEDICO'),
          ('Médico Dois', 'medico2@example.com', 'hash', 'MEDICO'),
          ('Gestor Um', 'gestor1@example.com', 'hash', 'GESTOR'),
          ('Gestor Dois', 'gestor2@example.com', 'hash', 'GESTOR'),
          ('Admin', 'admin@example.com', 'hash', 'ADMIN')
         RETURNING id, nome`,
      )
    ).rows
    const usuario = (nome: string) => usuarios.find((u) => u.nome === nome)!
    const gestor1 = usuario('Gestor Um')
    const gestor2 = usuario('Gestor Dois')

    await database.query(
      "INSERT INTO medicos (usuario_id, crm, uf_crm) SELECT id, '123456', 'DF' FROM usuarios WHERE nome = 'Médico Um'",
    )
    await database.query(
      "INSERT INTO medicos (usuario_id, crm, uf_crm) SELECT id, '654321', 'SP' FROM usuarios WHERE nome = 'Médico Dois'",
    )
    // Gestor Um tem perfil de gestor; Gestor Dois também, sem vínculo com a instituição.
    await database.query(
      "INSERT INTO gestores (usuario_id) SELECT id FROM usuarios WHERE nome IN ('Gestor Um', 'Gestor Dois')",
    )
    const instituicao = (
      await database.query<{ id: string }>(
        'INSERT INTO instituicoes (usuario_id, nome, cnpj, cidade, uf) VALUES ($1, $2, $3, $4, $5) RETURNING id',
        [gestor1.id, 'Hospital Teste', '11111111000111', 'Brasília', 'DF'],
      )
    ).rows[0]

    novoPlantao = async (params) => {
      const result = await database.query<{ id: string }>(
        `INSERT INTO plantoes (instituicao_id, gestor_criador_id, titulo, local_unidade,
          especialidade, data_inicio, data_fim, valor, quantidade_vagas,
          vagas_disponiveis, status)
         VALUES ($1, $2, $3, 'UTI', 'Clínica Médica', $4, $5, '1000.00', $6, $7, $8)
         RETURNING id`,
        [
          instituicao.id,
          gestor1.id,
          params.titulo,
          params.inicio,
          params.fim,
          params.quantidadeVagas ?? 1,
          params.vagasDisponiveis ?? params.quantidadeVagas ?? 1,
          params.status ?? 'ABERTO',
        ],
      )
      return result.rows[0].id
    }

    plantaoAbertoInicio = ts(5)
    plantaoAberto = await novoPlantao({
      titulo: 'Aberto com duas vagas',
      inicio: plantaoAbertoInicio,
      fim: ts(5.5),
      quantidadeVagas: 2,
    })
    plantaoUmaVaga = await novoPlantao({
      titulo: 'Uma vaga',
      inicio: ts(10),
      fim: ts(10.5),
    })

    const jwt = app.get(JwtService)
    medico1Token = `Bearer ${await jwt.signAsync({ sub: usuario('Médico Um').id })}`
    medico2Token = `Bearer ${await jwt.signAsync({ sub: usuario('Médico Dois').id })}`
    gestorToken = `Bearer ${await jwt.signAsync({ sub: gestor1.id })}`
    gestorEstranhoToken = `Bearer ${await jwt.signAsync({ sub: gestor2.id })}`
    adminToken = `Bearer ${await jwt.signAsync({ sub: usuario('Admin').id })}`
  })

  afterAll(async () => {
    await app?.close()
    await database?.close()
  })

  describe('UC05 — Candidatar-se', () => {
    it('exige autenticação (401) e perfil de médico (403)', async () => {
      await request(app.getHttpServer())
        .post(`/plantoes/${plantaoAberto}/candidaturas`)
        .expect(401)
      for (const token of [gestorToken, adminToken]) {
        await candidatar(plantaoAberto, token).expect(403)
      }
    })

    it('201 (MSG-09): candidatura registrada como PENDENTE', async () => {
      const resposta = await candidatar(plantaoAberto, medico1Token).expect(201)
      expect(resposta.body.message).toBe(
        'Candidatura enviada com sucesso! Acompanhe o status na sua agenda.',
      )
      expect(resposta.body.candidatura).toMatchObject({
        plantao_id: plantaoAberto,
        status: 'PENDENTE',
      })
      expect(resposta.body.candidatura.medico_id).toBeDefined()
    })

    it('409: candidatura repetida ao mesmo plantão', async () => {
      await candidatar(plantaoAberto, medico1Token).expect(201)
      await candidatar(plantaoAberto, medico1Token).expect(409)
    })

    it('404: candidatura a plantão inexistente', async () => {
      await candidatar(
        '00000000-0000-4000-8000-000000000001',
        medico1Token,
      ).expect(404)
    })

    it('409: plantão preenchido não aceita candidatura', async () => {
      const preenchido = await novoPlantao({
        titulo: 'Preenchido',
        inicio: ts(30),
        fim: ts(30.5),
        quantidadeVagas: 2,
        vagasDisponiveis: 2,
        status: 'PREENCHIDO',
      })
      await candidatar(preenchido, medico1Token).expect(409)
    })

    it('409 (MSG-10): bloqueia double-booking com alocação sobreposta', async () => {
      const plantaoConflito = await novoPlantao({
        titulo: 'Já alocado (conflito)',
        inicio: ts(5),
        fim: ts(6),
      })
      await alocarConfirmado(plantaoConflito, '654321')

      const resposta = await candidatar(plantaoAberto, medico2Token).expect(409)
      expect(resposta.body.message).toBe(
        'Conflito de agenda: você já possui um plantão confirmado neste horário.',
      )
      expect(resposta.body).not.toHaveProperty('candidatura')
    })

    it('201: horários que apenas tocam as bordas não são conflito (RN16)', async () => {
      // Alocação encerrando exatamente no início do plantão alvo.
      const plantaoEncerrando = await novoPlantao({
        titulo: 'Encerra na borda',
        inicio: ts(4),
        fim: plantaoAbertoInicio,
      })
      await alocarConfirmado(plantaoEncerrando, '654321')
      await candidatar(plantaoAberto, medico2Token).expect(201)
    })
  })

  describe('UC11 — Avaliar candidaturas', () => {
    it('listar exige autenticação (401) e gestor responsável (403)', async () => {
      await request(app.getHttpServer())
        .get(`/plantoes/${plantaoAberto}/candidaturas`)
        .expect(401)
      // Médico e gestor sem vínculo com a instituição: 403.
      await candidatar(plantaoAberto, medico1Token).expect(201)
      await request(app.getHttpServer())
        .get(`/plantoes/${plantaoAberto}/candidaturas`)
        .set('Authorization', medico1Token)
        .expect(403)
      await request(app.getHttpServer())
        .get(`/plantoes/${plantaoAberto}/candidaturas`)
        .set('Authorization', gestorEstranhoToken)
        .expect(403)
    })

    it('200: gestor lista candidatos do próprio plantão', async () => {
      await candidatar(plantaoAberto, medico1Token, { mensagem: 'Posso cobrir' })
      await candidatar(plantaoAberto, medico2Token)

      const resposta = await request(app.getHttpServer())
        .get(`/plantoes/${plantaoAberto}/candidaturas`)
        .set('Authorization', gestorToken)
        .expect(200)
      expect(resposta.body).toHaveLength(2)
      expect(resposta.body).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            status: 'PENDENTE',
            mensagem_medico: 'Posso cobrir',
            medico: expect.objectContaining({
              nome: 'Médico Um',
              crm: '123456',
              uf_crm: 'DF',
            }),
          }),
          expect.objectContaining({
            status: 'PENDENTE',
            medico: expect.objectContaining({ nome: 'Médico Dois' }),
          }),
        ]),
      )
    })

    it('aprovar exige gestor do plantão (401/403)', async () => {
      await candidatar(plantaoAberto, medico1Token).expect(201)
      const candidatura = (
        await database.query<{ id: string }>(
          'SELECT id FROM candidaturas LIMIT 1',
        )
      ).rows[0].id
      await request(app.getHttpServer())
        .post(`/plantoes/${plantaoAberto}/candidaturas/${candidatura}/aprovar`)
        .expect(401)
      await aprovar(plantaoAberto, candidatura, adminToken).expect(403)
      await aprovar(plantaoAberto, candidatura, gestorEstranhoToken).expect(403)
    })

    it('200 (MSG-17): aprovação cria alocação, pagamento pendente e decrementa vaga', async () => {
      await candidatar(plantaoAberto, medico1Token).expect(201)
      const candidatura = (
        await database.query<{ id: string }>(
          'SELECT id, medico_id FROM candidaturas',
        )
      ).rows[0]

      const aprovado = await aprovar(
        plantaoAberto,
        candidatura.id,
        gestorToken,
      ).expect(200)
      expect(aprovado.body.message).toBe(
        'Médico alocado com sucesso! Os demais candidatos foram notificados.',
      )
      expect(aprovado.body.alocacao).toMatchObject({
        plantao_id: plantaoAberto,
        medico_id: candidatura.medico_id,
      })
      expect(aprovado.body.plantao).toEqual({
        id: plantaoAberto,
        status: 'ABERTO',
        quantidade_vagas: 2,
        vagas_disponiveis: 1,
      })

      // Efeitos no banco: alocação, candidatura aprovada com gestor e momento.
      const alocacao = (
        await database.query<{ id: string }>(
          'SELECT id FROM alocacoes WHERE candidatura_id = $1',
          [candidatura.id],
        )
      ).rows
      expect(alocacao).toHaveLength(1)
      const candidaturaFinal = (
        await database.query<
          { status: string; analisado_por_gestor_id: string; analisado_at: string }[]
        >(
          'SELECT status, analisado_por_gestor_id, analisado_at FROM candidaturas WHERE id = $1',
          [candidatura.id],
        )
      ).rows[0]
      expect(candidaturaFinal.status).toBe('APROVADA')
      expect(candidaturaFinal.analisado_por_gestor_id).not.toBeNull()
      expect(candidaturaFinal.analisado_at).not.toBeNull()
      const pagamento = (
        await database.query<{ status: string; valor: string }[]>(
          'SELECT status, valor FROM pagamentos WHERE alocacao_id = $1',
          [alocacao[0].id],
        )
      ).rows[0]
      expect(pagamento.status).toBe('PENDENTE')
      expect(pagamento.valor).toBe('1000.00')
      const [plantaoFinal] = (
        await database.query<{ status: string; vagas_disponiveis: number }[]>(
          'SELECT status, vagas_disponiveis FROM plantoes WHERE id = $1',
          [plantaoAberto],
        )
      ).rows
      expect(plantaoFinal.status).toBe('ABERTO')
      expect(plantaoFinal.vagas_disponiveis).toBe(1)
    })

    it('409: candidatura já analisada não é re-aprovada', async () => {
      await candidatar(plantaoAberto, medico1Token).expect(201)
      const candidatura = (
        await database.query<{ id: string }>(
          'SELECT id FROM candidaturas LIMIT 1',
        )
      ).rows[0].id
      await aprovar(plantaoAberto, candidatura, gestorToken).expect(200)
      await aprovar(plantaoAberto, candidatura, gestorToken).expect(409)
    })

    it('404: candidatura de outro plantão não é aprovável por esta rota', async () => {
      await candidatar(plantaoAberto, medico1Token).expect(201)
      const candidatura = (
        await database.query<{ id: string }>(
          'SELECT id FROM candidaturas LIMIT 1',
        )
      ).rows[0].id
      await aprovar(plantaoUmaVaga, candidatura, gestorToken).expect(404)
    })

    it('409 (MSG-10): alocação confirmada em outro plantão sobreposto bloqueia aprovação', async () => {
      // RN16 na candidatura não dispara: o conflito surge depois.
      await candidatar(plantaoUmaVaga, medico1Token).expect(201)
      const candidatura = (
        await database.query<{ id: string }>(
          "SELECT id FROM candidaturas WHERE status = 'PENDENTE'",
        )
      ).rows[0].id

      const plantaoConflito = await novoPlantao({
        titulo: 'Sobreposição posterior',
        inicio: ts(10),
        fim: ts(11),
      })
      await alocarConfirmado(plantaoConflito, '123456')

      await aprovar(plantaoUmaVaga, candidatura, gestorToken).expect(409)
      // A candidatura continua pendente para futura análise.
      const final = (
        await database.query<{ status: string }[]>(
          'SELECT status FROM candidaturas WHERE id = $1',
          [candidatura],
        )
      ).rows[0]
      expect(final.status).toBe('PENDENTE')
    })

    it('RN21 — última vaga: plantão PREENCHIDO e rejeição em cascata', async () => {
      await candidatar(plantaoUmaVaga, medico1Token).expect(201)
      await candidatar(plantaoUmaVaga, medico2Token).expect(201)
      const candidaturas = (
        await database.query<{ id: string; medico_id: string }[]>(
          'SELECT id, medico_id FROM candidaturas ORDER BY medico_id',
        )
      ).rows
      const aprovada = candidaturas[0]
      const rejeitadaEsperada = candidaturas[1]

      const aprovado = await aprovar(
        plantaoUmaVaga,
        aprovada.id,
        gestorToken,
      ).expect(200)
      expect(aprovado.body.message).toBe(
        'Médico alocado com sucesso! Os demais candidatos foram notificados.',
      )
      expect(aprovado.body.plantao).toEqual({
        id: plantaoUmaVaga,
        status: 'PREENCHIDO',
        quantidade_vagas: 1,
        vagas_disponiveis: 0,
      })

      const final = (
        await database.query<{ medico_id: string; status: string }[]>(
          'SELECT medico_id, status FROM candidaturas ORDER BY medico_id',
        )
      ).rows
      expect(final).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ status: 'APROVADA' }),
          expect.objectContaining({
            medico_id: rejeitadaEsperada.medico_id,
            status: 'REJEITADA',
          }),
        ]),
      )
      const [plantaoFinal] = (
        await database.query<{ status: string; vagas_disponiveis: number }[]>(
          'SELECT status, vagas_disponiveis FROM plantoes WHERE id = $1',
          [plantaoUmaVaga],
        )
      ).rows
      expect(plantaoFinal).toMatchObject({
        status: 'PREENCHIDO',
        vagas_disponiveis: 0,
      })
    })
  })
})
