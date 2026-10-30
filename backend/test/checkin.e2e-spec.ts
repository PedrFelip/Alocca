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

const MINUTO = 60 * 1000
const daqui = (minutos: number) => new Date(Date.now() + minutos * MINUTO)

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

  function proximos(token: string) {
    return request(app.getHttpServer())
      .get('/presenca/proximos')
      .set('Authorization', token)
  }

  async function mudarPlantao(alocacaoId: string, mudanca: string) {
    await database.query(
      `UPDATE plantoes SET ${mudanca}
       FROM alocacoes WHERE alocacoes.plantao_id = plantoes.id AND alocacoes.id = $1`,
      [alocacaoId],
    )
  }

  async function mudarHorario(alocacaoId: string, inicio: Date, fim: Date) {
    await mudarPlantao(
      alocacaoId,
      `data_inicio = '${inicio.toISOString()}', data_fim = '${fim.toISOString()}'`,
    )
  }

  async function checkinDireto(alocacaoId: string) {
    await database.query(
      "INSERT INTO registros_ponto (alocacao_id, tipo_evento) VALUES ($1, 'ENTRADA')",
      [alocacaoId],
    )
  }

  async function registroSalvo(alocacaoId: string, tipo: string) {
    const [salvo] = (
      await database.query<{
        latitude: number | null
        longitude: number | null
        precisao_metros: number | null
      }>(
        'SELECT latitude, longitude, precisao_metros FROM registros_ponto WHERE alocacao_id = $1 AND tipo_evento = $2',
        [alocacaoId, tipo],
      )
    ).rows
    return salvo
  }

  // para o relogio do servidor num instante exato pra testar os limites
  function pararRelogio(instante: Date) {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(instante)
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

  afterEach(() => {
    vi.useRealTimers()
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
      expect((await registroSalvo(alocacao, 'ENTRADA')).precisao_metros).toBe(
        12.5,
      )
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
      expect((await registroSalvo(alocacao, 'ENTRADA')).latitude).toBeNull()
    })

    it('trata GPS fora do mapa como GPS negado na entrada e na saída', async () => {
      const entrada = await presenca(medicoToken, {
        alocacao_id: alocacao,
        tipo_evento: 'ENTRADA',
        latitude: 999,
        longitude: -47.88,
        precisao_metros: 10,
      }).expect(201)
      expect(entrada.body.message).toBe(
        'Check-in registrado sem localização (GPS negado).',
      )
      expect(entrada.body.registro.distancia_local).toBeNull()
      expect(await registroSalvo(alocacao, 'ENTRADA')).toEqual({
        latitude: null,
        longitude: null,
        precisao_metros: null,
      })

      const saida = await presenca(medicoToken, {
        alocacao_id: alocacao,
        tipo_evento: 'SAIDA',
        latitude: -15.8,
        longitude: 500,
      }).expect(201)
      expect(saida.body.message).toBe(
        'Check-out registrado sem localização (GPS negado).',
      )
      expect((await registroSalvo(alocacao, 'SAIDA')).longitude).toBeNull()
    })

    it('salva sem localização quando vem só a latitude', async () => {
      await presenca(medicoToken, {
        alocacao_id: alocacao,
        tipo_evento: 'ENTRADA',
        latitude: PERTO.latitude,
      }).expect(201)
      expect((await registroSalvo(alocacao, 'ENTRADA')).latitude).toBeNull()
    })

    it('ignora precisão negativa mas guarda as coordenadas', async () => {
      await presenca(medicoToken, {
        alocacao_id: alocacao,
        tipo_evento: 'ENTRADA',
        ...PERTO,
        precisao_metros: -5,
      }).expect(201)
      expect(await registroSalvo(alocacao, 'ENTRADA')).toEqual({
        ...PERTO,
        precisao_metros: null,
      })
    })

    it('não guarda o GPS quando o plantão não permite geolocalização', async () => {
      await mudarPlantao(alocacao, 'permite_geolocalizacao = false')
      const resposta = await presenca(medicoToken, {
        alocacao_id: alocacao,
        tipo_evento: 'ENTRADA',
        ...PERTO,
      }).expect(201)

      expect(resposta.body.registro.distancia_local).toBeNull()
      expect((await registroSalvo(alocacao, 'ENTRADA')).latitude).toBeNull()
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
      const resposta = await presenca(medicoToken, {
        alocacao_id: alocacao,
        tipo_evento: 'ENTRADA',
      }).expect(409)
      expect(resposta.body.message).toBe('Este plantão já terminou')
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

    it('aceita exatamente nos limites de horário', async () => {
      const agora = new Date()
      pararRelogio(agora)
      const entrada = { alocacao_id: alocacao, tipo_evento: 'ENTRADA' }

      // libera exatamente 10 minutos antes
      await mudarHorario(
        alocacao,
        new Date(agora.getTime() + 10 * MINUTO),
        new Date(agora.getTime() + 360 * MINUTO),
      )
      await presenca(medicoToken, entrada).expect(201)

      // ultimo instante do check-in e o fim do plantao
      await mudarHorario(
        alocacaoSemCoordenadas,
        new Date(agora.getTime() - 360 * MINUTO),
        agora,
      )
      await presenca(medicoToken, {
        alocacao_id: alocacaoSemCoordenadas,
        tipo_evento: 'ENTRADA',
      }).expect(201)

      // ultimo instante do check-out e 45 minutos depois do fim
      await checkinDireto(alocacaoOutroMedico)
      await mudarHorario(
        alocacaoOutroMedico,
        new Date(agora.getTime() - 400 * MINUTO),
        new Date(agora.getTime() - 45 * MINUTO),
      )
      await presenca(outroMedicoToken, {
        alocacao_id: alocacaoOutroMedico,
        tipo_evento: 'SAIDA',
      }).expect(201)
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

    it('não aceita plantão apagado (404)', async () => {
      await mudarPlantao(alocacao, 'deleted_at = now()')
      await presenca(medicoToken, {
        alocacao_id: alocacao,
        tipo_evento: 'ENTRADA',
      }).expect(404)
    })

    it('não aceita plantão cancelado (409)', async () => {
      await mudarPlantao(alocacao, "status = 'CANCELADO'")
      const resposta = await presenca(medicoToken, {
        alocacao_id: alocacao,
        tipo_evento: 'ENTRADA',
      }).expect(409)
      expect(resposta.body.message).toBe('Este plantão foi cancelado')
    })

    it('recusa quando o plantão não exige check-in', async () => {
      await mudarPlantao(alocacao, 'exige_checkin = false')
      const resposta = await presenca(medicoToken, {
        alocacao_id: alocacao,
        tipo_evento: 'ENTRADA',
      }).expect(409)
      expect(resposta.body.message).toBe('Este plantão não exige check-in')
    })

    it('recusa corpo malformado (400)', async () => {
      await presenca(medicoToken, {
        alocacao_id: 'nao-e-uuid',
        tipo_evento: 'ENTRADA',
      }).expect(400)
      await presenca(medicoToken, {
        alocacao_id: alocacao,
        tipo_evento: 'ALMOCO',
      }).expect(400)
      await presenca(medicoToken, {
        alocacao_id: alocacao,
        tipo_evento: 'ENTRADA',
        latitude: 'abc',
      }).expect(400)
    })
  })

  describe('GET /presenca/proximos', () => {
    it('exige login (401) e perfil de médico (403)', async () => {
      await request(app.getHttpServer()).get('/presenca/proximos').expect(401)
      await proximos(gestorToken).expect(403)
    })

    // o medico dois so tem uma alocacao, fica mais facil de conferir
    it('devolve o plantão em andamento com o check-in liberado', async () => {
      const resposta = await proximos(outroMedicoToken).expect(200)

      expect(resposta.body).toHaveLength(1)
      expect(resposta.body[0].alocacao_id).toBe(alocacaoOutroMedico)
      expect(resposta.body[0].instituicao.nome).toBe('Hospital Teste')
      expect(resposta.body[0].checkin_feito).toBe(false)
      expect(resposta.body[0].pode_fazer_checkin).toBe(true)
      expect(resposta.body[0].pode_fazer_checkout).toBe(false)
    })

    it('deixa o check-in bloqueado quando falta muito para começar', async () => {
      const inicio = daqui(60)
      await mudarHorario(alocacaoOutroMedico, inicio, daqui(420))

      const resposta = await proximos(outroMedicoToken).expect(200)
      expect(resposta.body).toHaveLength(1)
      expect(resposta.body[0].pode_fazer_checkin).toBe(false)
      expect(new Date(resposta.body[0].checkin_liberado_em).getTime()).toBe(
        inicio.getTime() - 10 * MINUTO,
      )
    })

    it('libera o check-out depois do check-in', async () => {
      await presenca(outroMedicoToken, {
        alocacao_id: alocacaoOutroMedico,
        tipo_evento: 'ENTRADA',
      }).expect(201)

      const resposta = await proximos(outroMedicoToken).expect(200)
      expect(resposta.body[0].checkin_feito).toBe(true)
      expect(resposta.body[0].pode_fazer_checkin).toBe(false)
      expect(resposta.body[0].pode_fazer_checkout).toBe(true)
    })

    it('volta vazio depois do check-out', async () => {
      await checkinDireto(alocacaoOutroMedico)
      await presenca(outroMedicoToken, {
        alocacao_id: alocacaoOutroMedico,
        tipo_evento: 'SAIDA',
      }).expect(201)

      const resposta = await proximos(outroMedicoToken).expect(200)
      expect(resposta.body).toEqual([])
    })

    it('volta vazio quando o plantão terminou sem check-in', async () => {
      await mudarHorario(alocacaoOutroMedico, daqui(-400), daqui(-1))

      const resposta = await proximos(outroMedicoToken).expect(200)
      expect(resposta.body).toEqual([])
    })

    it('mostra só o próximo quando nenhum está liberado', async () => {
      await mudarHorario(alocacao, daqui(120), daqui(480))
      await mudarHorario(alocacaoSemCoordenadas, daqui(60), daqui(420))

      const resposta = await proximos(medicoToken).expect(200)
      expect(resposta.body).toHaveLength(1)
      expect(resposta.body[0].alocacao_id).toBe(alocacaoSemCoordenadas)
    })

    it('mostra o check-out de um e o check-in do outro quando emenda plantões', async () => {
      // A terminou ha 5 min sem check-out, B comecou ha 5 min
      await checkinDireto(alocacao)
      await mudarHorario(alocacao, daqui(-725), daqui(-5))

      const resposta = await proximos(medicoToken).expect(200)
      expect(resposta.body).toHaveLength(2)
      expect(resposta.body[0].alocacao_id).toBe(alocacao)
      expect(resposta.body[0].pode_fazer_checkout).toBe(true)
      expect(resposta.body[1].alocacao_id).toBe(alocacaoSemCoordenadas)
      expect(resposta.body[1].pode_fazer_checkin).toBe(true)
    })

    it('não mostra plantão apagado, cancelado ou que não exige check-in', async () => {
      await mudarPlantao(alocacao, 'deleted_at = now()')
      await mudarPlantao(alocacaoSemCoordenadas, "status = 'CANCELADO'")
      await mudarPlantao(alocacaoOutroMedico, 'exige_checkin = false')

      expect((await proximos(medicoToken).expect(200)).body).toEqual([])
      expect((await proximos(outroMedicoToken).expect(200)).body).toEqual([])
    })

    it('concorda com o POST exatamente nos limites de horário', async () => {
      const agora = new Date()
      pararRelogio(agora)

      // sem check-in, no instante exato do fim ainda da pra fazer check-in
      await mudarHorario(
        alocacaoOutroMedico,
        new Date(agora.getTime() - 360 * MINUTO),
        agora,
      )
      const noFim = await proximos(outroMedicoToken).expect(200)
      expect(noFim.body[0].pode_fazer_checkin).toBe(true)

      // com check-in, no instante exato dos 45 min ainda da pra fazer check-out
      await checkinDireto(alocacaoOutroMedico)
      await mudarHorario(
        alocacaoOutroMedico,
        new Date(agora.getTime() - 400 * MINUTO),
        new Date(agora.getTime() - 45 * MINUTO),
      )
      const noPrazo = await proximos(outroMedicoToken).expect(200)
      expect(noPrazo.body[0].pode_fazer_checkout).toBe(true)
    })
  })
})
