export type ResumoFinanceiro = {
  total_recebido: string
  total_a_receber: string
  total_pendente: string
}

export type PagamentoDoMedico = {
  id: string
  valor: string
  status: 'PENDENTE' | 'PAGO'
  vencimento_em: Date | null
  pago_at: Date | null
  plantao: {
    id: string
    titulo: string
    data_inicio: Date
    data_fim: Date
  }
  instituicao: {
    nome: string
    cidade: string | null
    uf: string | null
  }
}

export type DashboardFinanceiro = {
  resumo: ResumoFinanceiro
  pagamentos: PagamentoDoMedico[]
}
