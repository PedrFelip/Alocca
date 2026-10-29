import { PGlite } from '@electric-sql/pglite'
import type { INestApplication } from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'
import { Test } from '@nestjs/testing'
import { drizzle } from 'drizzle-orm/pglite'
import { readFile, readdir } from 'node:fs/promises'
import request from 'supertest'
import { AppModule } from '../src/app.module.ts'
import { DRIZZLE_DB } from '../src/db/db.provider.ts'

// hospital do teste e um ponto a uns 100 m dele
const HOSPITAL = { latitude: -15.8011, longitude: -47.8838 }
const PERTO = { latitude: -15.8002, longitude: -47.8838 }

const daqui = (minutos: number) => new Date(Date.now() + minutos * 60 * 1000)

describe('Check-in e check-out (UC06)', () => {
  let app: INestApplication
  let database: PGlite
  let medicoToken: string
  let outroMedicoToken: string
  let gestorToken: string
  let alocacao: string
  let alocacaoOutroMedico: string
  let alocacaoSemCoordenadas: string

  function presenca(token: string, corpo: object) {
    return request(app.getHttpServer())
      .post('/presenca')
      .set('Authorization', token)
      .send(corpo)
  }

  function proximo(token: string) {
    return request(app.getHttpServer())
      .get('/presenca/proximo')
      .set('Authorization', token)
  }

  async function mudarHorario(alocacaoId: string, inicio: Date, fim: Date) {
    await database.query(
      `UPDATE plantoes SET data_inicio = $1, data_fim = $2
       FROM alocacoes WHERE alocacoes.plantao_id = plantoes.id AND alocacoes.id = $3`,
      [inicio.toISOString(), fim.toISOString(), alocacaoId],
    )
  }

  async function checkinDireto(alocacaoId: string) {
    await database.query(
      "INSERT INTO registros_ponto (alocacao_id, tipo_evento) VALUES ($1, 'ENTRADA')",
      [alocacaoId],
    )
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
    const gestor = usuario('Gestor Um')

    const medicos = (
      await database.query<{ id: string; crm: string }>(
        `INSERT INTO medicos (usuario_id, crm, uf_crm, especialidade)
           SELECT id, '123456', 'DF', 'Clínica Médica' FROM usuarios WHERE nome = 'Médico Um'
         UNION ALL
           SELECT id, '654321', 'SP', 'Clínica Médica' FROM usuarios WHERE nome = 'Médico Dois'
         RETURNING id, crm`,
      )
    ).rows
    const medico1 = medicos.find((m) => m.crm === '123456')!.id
    const medico2 = medicos.find((m) => m.crm === '654321')!.id

    const criarInstituicao = async (
      cnpj: string,
      latitude: number | null,
      longitude: number | null,
    ) =>
      (
        await database.query<{ id: string }>(
          `INSERT INTO instituicoes (usuario_id, nome, cnpj, latitude, longitude)
           VALUES ($1, 'Hospital Teste', $2, $3, $4) RETURNING id`,
          [gestor.id, cnpj, latitude, longitude],
        )
      ).rows[0].id
    const comCoordenadas = await criarInstituicao(
      '11111111000111',
      HOSPITAL.latitude,
      HOSPITAL.longitude,
    )
    const semCoordenadas = await criarInstituicao('22222222000122', null, null)

    // plantao que comecou ha 5 minutos e vai ate daqui 6 horas
    const criarAlocacao = async (instituicaoId: string, medicoId: string) => {
      const [plantao] = (
        await database.query<{ id: string }>(
          `INSERT INTO plantoes (instituicao_id, gestor_criador_id, titulo, local_unidade,
            especialidade, data_inicio, data_fim, valor, quantidade_vagas,
            vagas_disponiveis, status)
           VALUES ($1, $2, 'Plantão', 'UTI', 'Clínica Médica', $3, $4, '700.00', 1, 0, 'PREENCHIDO')
           RETURNING id`,
          [
            instituicaoId,
            gestor.id,
            daqui(-5).toISOString(),
            daqui(360).toISOString(),
          ],
        )
      ).rows
      const [candidatura] = (
        await database.query<{ id: string }>(
          "INSERT INTO candidaturas (plantao_id, medico_id, status) VALUES ($1, $2, 'APROVADA') RETURNING id",
          [plantao.id, medicoId],
        )
      ).rows
      return (
        await database.query<{ id: string }>(
          'INSERT INTO alocacoes (plantao_id, medico_id, candidatura_id) VALUES ($1, $2, $3) RETURNING id',
          [plantao.id, medicoId, candidatura.id],
        )
      ).rows[0].id
    }

    alocacao = await criarAlocacao(comCoordenadas, medico1)
    alocacaoSemCoordenadas = await criarAlocacao(semCoordenadas, medico1)
    alocacaoOutroMedico = await criarAlocacao(comCoordenadas, medico2)

    const jwt = app.get(JwtService)
    medicoToken = `Bearer ${await jwt.signAsync({ sub: usuario('Médico Um').id })}`
    outroMedicoToken = `Bearer ${await jwt.signAsync({ sub: usuario('Médico Dois').id })}`
    gestorToken = `Bearer ${await jwt.signAsync({ sub: gestor.id })}`
  })

  afterAll(async () => {
    await app?.close()
    await database?.close()
  })

  describe('POST /presenca', () => {
    it('exige login (401) e perfil de médico (403)', async () => {
      await request(app.getHttpServer())
        .post('/presenca')
        .send({ alocacao_id: alocacao, tipo_evento: 'ENTRADA' })
        .expect(401)
      await presenca(gestorToken, {
        alocacao_id: alocacao,
        tipo_evento: 'ENTRADA',
      }).expect(403)
    })

    it('faz check-in com GPS e calcula a distância até o hospital (MSG-11)', async () => {
      const resposta = await presenca(medicoToken, {
        alocacao_id: alocacao,
        tipo_evento: 'ENTRADA',
        ...PERTO,
        precisao_metros: 12.5,
      }).expect(201)

      expect(resposta.body.message).toBe(
        'Check-in registrado com sucesso. Bom plantão!',
      )
      expect(resposta.body.registro.tipo_evento).toBe('ENTRADA')
      expect(resposta.body.registro.distancia_local).toBeCloseTo(100, -1)
    })

    it('faz check-in sem GPS só com o horário do servidor (MSG-12)', async () => {
      const resposta = await presenca(medicoToken, {
        alocacao_id: alocacao,
        tipo_evento: 'ENTRADA',
        latitude: null,
        longitude: null,
      }).expect(201)

      expect(resposta.body.message).toBe(
        'Check-in registrado sem localização (GPS negado).',
      )
      const [salvo] = (
        await database.query<{ latitude: number | null }>(
          'SELECT latitude FROM registros_ponto WHERE alocacao_id = $1',
          [alocacao],
        )
      ).rows
      expect(salvo.latitude).toBeNull()
    })

    it('registra sem distância quando o hospital não tem localização', async () => {
      const resposta = await presenca(medicoToken, {
        alocacao_id: alocacaoSemCoordenadas,
        tipo_evento: 'ENTRADA',
        ...PERTO,
      }).expect(201)

      expect(resposta.body.registro.distancia_local).toBeNull()
    })

    it('não deixa repetir o check-in (409)', async () => {
      const corpo = { alocacao_id: alocacao, tipo_evento: 'ENTRADA' }
      await presenca(medicoToken, corpo).expect(201)
      await presenca(medicoToken, corpo).expect(409)
    })

    it('libera o check-in só 10 minutos antes do início', async () => {
      const corpo = { alocacao_id: alocacao, tipo_evento: 'ENTRADA' }
      await mudarHorario(alocacao, daqui(30), daqui(390))
      const cedo = await presenca(medicoToken, corpo).expect(409)
      expect(cedo.body.message).toBe(
        'O check-in libera 10 minutos antes do plantão',
      )

      await mudarHorario(alocacao, daqui(8), daqui(368))
      await presenca(medicoToken, corpo).expect(201)
    })

    it('não deixa fazer check-in depois que o plantão terminou', async () => {
      await mudarHorario(alocacao, daqui(-400), daqui(-1))
      await presenca(medicoToken, {
        alocacao_id: alocacao,
        tipo_evento: 'ENTRADA',
      }).expect(409)
    })

    it('não deixa fazer check-out sem check-in (409)', async () => {
      await presenca(medicoToken, {
        alocacao_id: alocacao,
        tipo_evento: 'SAIDA',
      }).expect(409)
    })

    it('faz check-out depois do check-in', async () => {
      await presenca(medicoToken, {
        alocacao_id: alocacao,
        tipo_evento: 'ENTRADA',
      }).expect(201)
      const resposta = await presenca(medicoToken, {
        alocacao_id: alocacao,
        tipo_evento: 'SAIDA',
        ...PERTO,
      }).expect(201)

      expect(resposta.body.message).toBe('Check-out registrado com sucesso.')
    })

    it('aceita o check-out até 45 minutos depois do fim', async () => {
      const corpo = { alocacao_id: alocacao, tipo_evento: 'SAIDA' }
      await checkinDireto(alocacao)

      await mudarHorario(alocacao, daqui(-400), daqui(-50))
      const tarde = await presenca(medicoToken, corpo).expect(409)
      expect(tarde.body.message).toBe('O prazo para o check-out já acabou')

      await mudarHorario(alocacao, daqui(-400), daqui(-40))
      await presenca(medicoToken, corpo).expect(201)
    })

    it('não acha a alocação de outro médico (404)', async () => {
      await presenca(outroMedicoToken, {
        alocacao_id: alocacao,
        tipo_evento: 'ENTRADA',
      }).expect(404)
      await presenca(medicoToken, {
        alocacao_id: alocacaoOutroMedico,
        tipo_evento: 'ENTRADA',
      }).expect(404)
    })

    it('recusa coordenada impossível (400)', async () => {
      await presenca(medicoToken, {
        alocacao_id: alocacao,
        tipo_evento: 'ENTRADA',
        latitude: 999,
        longitude: -47.88,
      }).expect(400)
    })
  })

  // o medico dois so tem uma alocacao, fica mais facil de conferir
  describe('GET /presenca/proximo', () => {
    it('exige login (401) e perfil de médico (403)', async () => {
      await request(app.getHttpServer()).get('/presenca/proximo').expect(401)
      await proximo(gestorToken).expect(403)
    })

    it('devolve o plantão em andamento com o check-in liberado', async () => {
      const resposta = await proximo(outroMedicoToken).expect(200)

      expect(resposta.body.alocacao_id).toBe(alocacaoOutroMedico)
      expect(resposta.body.instituicao.nome).toBe('Hospital Teste')
      expect(resposta.body.checkin_feito).toBe(false)
      expect(resposta.body.pode_fazer_checkin).toBe(true)
      expect(resposta.body.pode_fazer_checkout).toBe(false)
    })

    it('deixa o check-in bloqueado quando falta muito para começar', async () => {
      const inicio = daqui(60)
      await mudarHorario(alocacaoOutroMedico, inicio, daqui(420))

      const resposta = await proximo(outroMedicoToken).expect(200)
      expect(resposta.body.pode_fazer_checkin).toBe(false)
      expect(new Date(resposta.body.checkin_liberado_em).getTime()).toBe(
        inicio.getTime() - 10 * 60 * 1000,
      )
    })

    it('libera o check-out depois do check-in', async () => {
      await presenca(outroMedicoToken, {
        alocacao_id: alocacaoOutroMedico,
        tipo_evento: 'ENTRADA',
      }).expect(201)

      const resposta = await proximo(outroMedicoToken).expect(200)
      expect(resposta.body.checkin_feito).toBe(true)
      expect(resposta.body.pode_fazer_checkin).toBe(false)
      expect(resposta.body.pode_fazer_checkout).toBe(true)
    })

    it('some depois do check-out (404)', async () => {
      await checkinDireto(alocacaoOutroMedico)
      await presenca(outroMedicoToken, {
        alocacao_id: alocacaoOutroMedico,
        tipo_evento: 'SAIDA',
      }).expect(201)

      const resposta = await proximo(outroMedicoToken).expect(404)
      expect(resposta.body.message).toBe('Nenhum plantão próximo')
    })

    it('pega o que começa primeiro', async () => {
      await mudarHorario(alocacao, daqui(120), daqui(480))
      await mudarHorario(alocacaoSemCoordenadas, daqui(60), daqui(420))

      const resposta = await proximo(medicoToken).expect(200)
      expect(resposta.body.alocacao_id).toBe(alocacaoSemCoordenadas)
    })
  })
})
