import { DRIZZLE_DB, type Database } from '../db/db.provider.ts'
import { CheckinRepository } from './checkin.repository.ts'
import { PerfilMedicoService } from '../medicos/perfil-medico.service.ts'
import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import type { RegistrarPresenca } from './checkin.schemas.ts'
import { DISTANCIA_MAXIMA_METROS, distanciaEmMetros } from './distancia.ts'
import {
  checkinLiberadoEm,
  checkoutAte,
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

@Injectable()
export class CheckinService {
  constructor(
    @Inject(DRIZZLE_DB) private readonly db: Database,
    @Inject(CheckinRepository) private readonly registros: CheckinRepository,
    @Inject(PerfilMedicoService) private readonly perfis: PerfilMedicoService,
  ) {}

  async registrar(usuarioId: string, dados: RegistrarPresenca) {
    const medicoId = await this.perfis.idDoUsuario(usuarioId)

    // Serializa validação e gravação com o cancelamento do plantão.
    return this.db.transaction(async (tx) => {
      // o medico é pego pelo token para ninguem marcar presenca no plantao do outro
      const [alocacao] = await this.registros.alocacaoDoMedico(
        tx,
        medicoId,
        dados.alocacao_id,
      )
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
        const [entrada] = await this.registros.entrada(tx, dados.alocacao_id)
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
      const acao = dados.tipo_evento === 'ENTRADA' ? 'check-in' : 'check-out'
      const hospitalTemLocal =
        alocacao.hospital_lat != null && alocacao.hospital_lon != null

      // se da pra conferir a distancia, sem GPS nao entra. quem nao quer
      // exigir localizacao publica o plantao sem geolocalizacao (LGPD)
      if (
        alocacao.permite_geolocalizacao &&
        hospitalTemLocal &&
        !gpsValido(dados.latitude, dados.longitude)
      ) {
        throw new ConflictException(
          `Ative a localização do celular para fazer o ${acao} deste plantão.`,
        )
      }

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
        if (hospitalTemLocal) {
          distancia = distanciaEmMetros(
            latitude,
            longitude,
            alocacao.hospital_lat!,
            alocacao.hospital_lon!,
          )
          // longe do hospital nao deixa registrar, assim a localizacao vale de verdade
          if (distancia > DISTANCIA_MAXIMA_METROS) {
            throw new ConflictException(
              `Você está a ${Math.round(distancia)} m do hospital. O ${acao} só pode ser feito a até ${DISTANCIA_MAXIMA_METROS} m.`,
            )
          }
        }
      }

      try {
        // hora do servidor, nao do celular
        const [registro] = await this.registros.inserir(tx, dados, {
          latitude,
          longitude,
          precisao,
          distancia,
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
    })
  }

  // plantoes que a tela de check-in deve mostrar. normalmente vem 1, mas
  // se o medico emendar dois plantoes vem o check-out de um e o check-in do outro
  async proximos(usuarioId: string) {
    const medicoId = await this.perfis.idDoUsuario(usuarioId)
    const agora = new Date()

    const candidatos = await this.registros.proximos(medicoId, agora)

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
}
