import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import {
  and,
  asc,
  eq,
  exists,
  gte,
  isNull,
  ne,
  notExists,
  sql,
} from 'drizzle-orm'
import { DRIZZLE_DB, type Database } from '../db/db.provider.ts'
import {
  alocacoesTable,
  instituicoesTable,
  medicosTable,
  plantoesTable,
  registrosPontoTable,
} from '../db/schemas/index.ts'
import type { RegistrarPresenca } from './checkin.schemas.ts'
import { distanciaEmMetros } from './distancia.ts'
import {
  checkinLiberadoEm,
  checkoutAte,
  DEPOIS_DO_FIM,
  podeFazerCheckin,
  podeFazerCheckout,
} from './horario.ts'

const MENSAGENS = {
  ENTRADA: {
    comGps: 'Check-in registrado com sucesso. Bom plantão!',
    semGps: 'Check-in registrado sem localização (GPS negado).',
  },
  SAIDA: {
    comGps: 'Check-out registrado com sucesso.',
    semGps: 'Check-out registrado sem localização (GPS negado).',
  },
}

function gpsValido(latitude?: number | null, longitude?: number | null) {
  return (
    latitude != null &&
    longitude != null &&
    Math.abs(latitude) <= 90 &&
    Math.abs(longitude) <= 180
  )
}

// o POST e o GET usam os mesmos filtros pra nunca discordarem
function alocacaoAtivaDoMedico(medicoId: string) {
  return [
    eq(alocacoesTable.medico_id, medicoId),
    isNull(alocacoesTable.deleted_at),
    isNull(plantoesTable.deleted_at),
    isNull(instituicoesTable.deleted_at),
  ]
}

@Injectable()
export class CheckinService {
  constructor(@Inject(DRIZZLE_DB) private readonly db: Database) {}

  async registrar(usuarioId: string, dados: RegistrarPresenca) {
    const medicoId = await this.perfilMedicoId(usuarioId)

    // o medico é pego pelo token para ninguem marcar presenca no plantao do outro
    const [alocacao] = await this.db
      .select({
        status_plantao: plantoesTable.status,
        exige_checkin: plantoesTable.exige_checkin,
        data_inicio: plantoesTable.data_inicio,
        data_fim: plantoesTable.data_fim,
        permite_geolocalizacao: plantoesTable.permite_geolocalizacao,
        hospital_lat: instituicoesTable.latitude,
        hospital_lon: instituicoesTable.longitude,
      })
      .from(alocacoesTable)
      .innerJoin(plantoesTable, eq(alocacoesTable.plantao_id, plantoesTable.id))
      .innerJoin(
        instituicoesTable,
        eq(plantoesTable.instituicao_id, instituicoesTable.id),
      )
      .where(
        and(
          eq(alocacoesTable.id, dados.alocacao_id),
          ...alocacaoAtivaDoMedico(medicoId),
        ),
      )
      .limit(1)
    if (!alocacao) throw new NotFoundException('Alocação não encontrada')
    if (alocacao.status_plantao === 'CANCELADO') {
      throw new ConflictException('Este plantão foi cancelado')
    }
    if (!alocacao.exige_checkin) {
      throw new ConflictException('Este plantão não exige check-in')
    }

    // a hora é sempre a do servidor, a tela so mostra o que o back deixa
    const agora = new Date()
    if (dados.tipo_evento === 'ENTRADA') {
      if (agora < checkinLiberadoEm(alocacao.data_inicio)) {
        throw new ConflictException(
          'O check-in libera 10 minutos antes do plantão',
        )
      }
      if (!podeFazerCheckin(alocacao.data_inicio, alocacao.data_fim, agora)) {
        throw new ConflictException('Este plantão já terminou')
      }
    }

    if (dados.tipo_evento === 'SAIDA') {
      const [entrada] = await this.db
        .select({ id: registrosPontoTable.id })
        .from(registrosPontoTable)
        .where(
          and(
            eq(registrosPontoTable.alocacao_id, dados.alocacao_id),
            eq(registrosPontoTable.tipo_evento, 'ENTRADA'),
          ),
        )
        .limit(1)
      if (!entrada) {
        throw new ConflictException('Faça o check-in antes do check-out')
      }
      if (!podeFazerCheckout(alocacao.data_fim, agora)) {
        throw new ConflictException('O prazo para o check-out já acabou')
      }
    }

    // RN19: so salva o gps se o plantão aceitar e se ele for valido
    let latitude: number | null = null
    let longitude: number | null = null
    let precisao: number | null = null
    let distancia: number | null = null
    if (
      alocacao.permite_geolocalizacao &&
      gpsValido(dados.latitude, dados.longitude)
    ) {
      latitude = dados.latitude!
      longitude = dados.longitude!
      if (dados.precisao_metros != null && dados.precisao_metros >= 0) {
        precisao = dados.precisao_metros
      }
      // hospital sem coordenada salva sem distância
      if (alocacao.hospital_lat != null && alocacao.hospital_lon != null) {
        distancia = distanciaEmMetros(
          latitude,
          longitude,
          alocacao.hospital_lat,
          alocacao.hospital_lon,
        )
      }
    }

    try {
      // hora do servidor, nao do celular
      const [registro] = await this.db
        .insert(registrosPontoTable)
        .values({
          alocacao_id: dados.alocacao_id,
          tipo_evento: dados.tipo_evento,
          latitude,
          longitude,
          precisao_metros: precisao,
          distancia_local: distancia,
        })
        .returning({
          id: registrosPontoTable.id,
          tipo_evento: registrosPontoTable.tipo_evento,
          timestamp_servidor: registrosPontoTable.timestamp_servidor,
          distancia_local: registrosPontoTable.distancia_local,
        })

      const mensagens = MENSAGENS[dados.tipo_evento]
      return {
        message: latitude === null ? mensagens.semGps : mensagens.comGps,
        registro,
      }
    } catch (erro) {
      // 23505 = ja existe entrada/saida dessa alocacao
      const codigo = ((erro as { code?: string }).code ??
        (erro as { cause?: { code?: string } }).cause?.code) as
        | string
        | undefined
      if (codigo === '23505') {
        throw new ConflictException(
          dados.tipo_evento === 'ENTRADA'
            ? 'Você já fez o check-in deste plantão'
            : 'Você já fez o check-out deste plantão',
        )
      }
      throw erro
    }
  }

  // plantoes que a tela de check-in deve mostrar. normalmente vem 1, mas
  // se o medico emendar dois plantoes vem o check-out de um e o check-in do outro
  async proximos(usuarioId: string) {
    const medicoId = await this.perfilMedicoId(usuarioId)
    const agora = new Date()

    const registro = (tipo: 'ENTRADA' | 'SAIDA') =>
      this.db
        .select({ um: sql`1` })
        .from(registrosPontoTable)
        .where(
          and(
            eq(registrosPontoTable.alocacao_id, alocacoesTable.id),
            eq(registrosPontoTable.tipo_evento, tipo),
          ),
        )

    // o banco so corta o que ja passou do prazo, quem decide o resto
    // sao as mesmas funcoes do POST (horario.ts)
    const candidatos = await this.db
      .select({
        alocacao_id: alocacoesTable.id,
        checkin_feito: sql<boolean>`${exists(registro('ENTRADA'))}`,
        plantao: {
          id: plantoesTable.id,
          titulo: plantoesTable.titulo,
          especialidade: plantoesTable.especialidade,
          local_unidade: plantoesTable.local_unidade,
          data_inicio: plantoesTable.data_inicio,
          data_fim: plantoesTable.data_fim,
        },
        instituicao: {
          id: instituicoesTable.id,
          nome: instituicoesTable.nome,
          cidade: instituicoesTable.cidade,
          uf: instituicoesTable.uf,
        },
      })
      .from(alocacoesTable)
      .innerJoin(plantoesTable, eq(alocacoesTable.plantao_id, plantoesTable.id))
      .innerJoin(
        instituicoesTable,
        eq(plantoesTable.instituicao_id, instituicoesTable.id),
      )
      .where(
        and(
          ...alocacaoAtivaDoMedico(medicoId),
          ne(plantoesTable.status, 'CANCELADO'),
          eq(plantoesTable.exige_checkin, true),
          notExists(registro('SAIDA')),
          gte(
            plantoesTable.data_fim,
            new Date(agora.getTime() - DEPOIS_DO_FIM),
          ),
        ),
      )
      .orderBy(asc(plantoesTable.data_inicio), asc(alocacoesTable.id))

    const plantoes = candidatos.map((candidato) => {
      const { data_inicio, data_fim } = candidato.plantao
      const checkinFeito = Boolean(candidato.checkin_feito)
      return {
        ...candidato,
        checkin_feito: checkinFeito,
        pode_fazer_checkin:
          !checkinFeito && podeFazerCheckin(data_inicio, data_fim, agora),
        pode_fazer_checkout: checkinFeito && podeFazerCheckout(data_fim, agora),
        checkin_liberado_em: checkinLiberadoEm(data_inicio),
        checkout_ate: checkoutAte(data_fim),
      }
    })

    const disponiveis = plantoes.filter(
      (p) => p.pode_fazer_checkin || p.pode_fazer_checkout,
    )
    if (disponiveis.length > 0) return disponiveis

    // nada liberado agora: mostra o proximo pra tela dizer quando libera
    const proximo = plantoes.find(
      (p) => !p.checkin_feito && agora < p.checkin_liberado_em,
    )
    return proximo ? [proximo] : []
  }

  private async perfilMedicoId(usuarioId: string) {
    const [medico] = await this.db
      .select({ id: medicosTable.id })
      .from(medicosTable)
      .where(
        and(
          eq(medicosTable.usuario_id, usuarioId),
          isNull(medicosTable.deleted_at),
        ),
      )
      .limit(1)
    if (!medico) throw new NotFoundException('Perfil médico não encontrado')
    return medico.id
  }
}
