import { performance } from 'node:perf_hooks'
import {
  atrasoRetry,
  FalhaEntrega,
  type CanalEntrega,
  type Entrega,
} from './contrato.ts'
import { RepositorioEntregas } from './repositorio.ts'

export class WorkerNotificacoes {
  private executando = false
  constructor(
    private readonly repo: RepositorioEntregas,
    private readonly canais: Record<'email', CanalEntrega>,
    private readonly concorrencia = 8,
    private readonly log: (evento: object) => void = (evento) =>
      console.log(JSON.stringify(evento)),
  ) {}
  async ciclo(): Promise<number> {
    if (this.executando) return 0
    this.executando = true
    try {
      const expandidas = await this.repo.expandir(100)
      const lote = await this.repo.reservar(this.concorrencia)
      const resultados = await Promise.allSettled(
        lote.map((e) => this.entregar(e)),
      )
      if (resultados.some((r) => r.status === 'rejected'))
        throw new Error('Falha ao persistir entrega')
      return lote.length || expandidas
    } finally {
      this.executando = false
    }
  }
  private async entregar(e: Entrega) {
    const inicio = performance.now()
    let estado = 'ENVIADA'
    let codigo: string | null = null
    let atraso = 0
    try {
      const mensagem = await this.repo.mensagem(e)
      if (!mensagem) {
        estado = 'CANCELADA'
        codigo = 'DESTINO_INATIVO_OU_PREFERENCIA'
      } else if (e.tentativas > 8) {
        estado = 'FALHOU'
        codigo = 'LIMITE_TENTATIVAS'
      } else await this.canais[e.canal].enviar(mensagem)
    } catch (err) {
      const falha =
        err instanceof FalhaEntrega ? err : new FalhaEntrega('ERRO_INTERNO')
      codigo = falha.codigo
      estado = falha.bloqueada
        ? 'BLOQUEADA'
        : falha.permanente || e.tentativas >= 8
          ? 'FALHOU'
          : 'PENDENTE'
      atraso = Math.max(atrasoRetry(e.tentativas), falha.retryAfterMs)
    }
    const atualizado = await this.repo.finalizar(e, estado, codigo, atraso)
    this.log({
      evento: 'NOTIFICACAO_ENTREGA',
      entrega_id: e.id,
      canal: e.canal,
      estado,
      tentativa: e.tentativas,
      codigo,
      atualizado,
      duracao_ms: Math.round(performance.now() - inicio),
    })
  }
  fechar() {
    Object.values(this.canais).forEach((c) => c.fechar())
  }
}
