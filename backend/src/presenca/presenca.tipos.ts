export type RegistroPresenca = {
  id: string
  tipo_evento: 'ENTRADA' | 'SAIDA'
  timestamp_servidor: Date
  com_localizacao: boolean
}

export type PresencaDaAlocacao = {
  alocacao: {
    id: string
    confirmado_at: Date
    plantao: {
      id: string
      titulo: string
      data_inicio: Date
      data_fim: Date
      local_unidade: string
    }
    instituicao: {
      id: string
      nome: string
      cidade: string | null
      uf: string | null
    }
  }
  registros: RegistroPresenca[]
}

export type HistoricoItem = RegistroPresenca & {
  alocacao_id: string
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
