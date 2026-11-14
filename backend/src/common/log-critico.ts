import type { statusPlantao } from '../db/schemas/plantoes.ts'

export type StatusPlantao = (typeof statusPlantao.enumValues)[number]

export type MotivoLoginFalho =
  | 'EMAIL_INEXISTENTE'
  | 'SENHA_INCORRETA'
  | 'CONTA_BLOQUEADA_RN08'
  | 'USUARIO_INATIVO'
  | 'USUARIO_BLOQUEADO'

export type EventoLogCritico =
  | {
      evento: 'LOGIN_FALHO'
      motivo: MotivoLoginFalho
      usuario_id: string | null
      email_mascarado: string
      tentativas_falhas?: number
    }
  | {
      evento: 'CANDIDATURA_CRIADA'
      plantao_id: string
      medico_id: string
    }
  | {
      evento: 'ALOCACAO_APROVADA'
      plantao_id: string
      candidatura_id: string
      alocacao_id: string
      medico_id: string
      gestor_id: string
      plantao_preenchido: boolean
      plantao_status: StatusPlantao
      notificacoes: Array<{
        usuario_destino_id: string
        tipo: string
      }>
      outbox_ids: string[]
    }

/**
 * Mascara o e-mail antes de gravar em log, preservando apenas o mínimo
 * para diagnóstico sem expor o endereço completo.
 */
export function mascararEmail(email: string): string {
  const normalizado = email.trim().toLowerCase()
  const indiceArroba = normalizado.lastIndexOf('@')
  if (indiceArroba <= 0 || indiceArroba === normalizado.length - 1) {
    return '***'
  }
  const local = normalizado.slice(0, indiceArroba)
  const dominio = normalizado.slice(indiceArroba + 1)
  if (local.length <= 2 || local.includes('*')) {
    return `***@${dominio}`
  }
  return `${local[0]}***@${dominio}`
}

/**
 * Serializa eventos críticos no formato JSON padronizado para emissão
 * via `Logger` do NestJS (que acrescenta nível, contexto e timestamp).
 */
export function serializarLogCritico(payload: EventoLogCritico): string {
  return JSON.stringify(payload)
}
