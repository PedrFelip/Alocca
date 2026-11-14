export type AgendaPeriodo = {
  ano: number
  mes: number
}

export type AgendaItem = {
  id: string
  tipo_origem: 'CANDIDATURA' | 'ALOCACAO'
  status: 'PENDENTE' | 'CONFIRMADO' | 'CONCLUIDO'
  plantao: {
    id: string
    titulo: string
    especialidade: string
    data_inicio: Date
    data_fim: Date
    valor: string
    local_unidade: string
  }
  instituicao: {
    id: string
    nome: string
    cidade: string | null
    uf: string | null
  }
}

export type AgendaDia = {
  dia: string
  itens: AgendaItem[]
}
