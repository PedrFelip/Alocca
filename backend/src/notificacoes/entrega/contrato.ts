export type Entrega = {
  id: string
  notificacao_id: string
  canal: 'email'
  destino: string
  lease_id: string
  tentativas: number
}
export type Mensagem = {
  notificacaoId: string
  plantaoId: string
  tipo: string
  destino: string
}
export interface CanalEntrega {
  enviar(mensagem: Mensagem): Promise<void>
  fechar(): void
}
export class FalhaEntrega extends Error {
  constructor(
    readonly codigo: string,
    readonly permanente = false,
    readonly retryAfterMs = 0,
    readonly bloqueada = false,
  ) {
    super(codigo)
  }
}
export function atrasoRetry(tentativa: number, random = Math.random): number {
  return (
    Math.min(3_600_000, 30_000 * 2 ** Math.min(tentativa - 1, 10)) *
    (0.75 + random() * 0.25)
  )
}
