import postgres from 'postgres'

// as colunas sao timestamp sem fuso: o now() do banco usa o fuso da sessao,
// entao a sessao fica sempre em UTC, nao importa o fuso do servidor (#77).
// A leitura de timestamp sem fuso (OID 1114) tambem fica ancorada em UTC:
// sem isso, o postgres-js converte a string com o fuso do processo Node e um
// vencimento de fim de dia sai deslocado no JSON (#78).
function parseTimestampUtc(valor: string) {
  const deslocado = /[zZ]|[+-]\d{2}:?\d{2}$/.test(valor)
  return new Date(valor.replace(' ', 'T') + (deslocado ? '' : 'Z'))
}

export function criarClientePostgres(
  url: string,
  opcoes: postgres.Options<Record<string, postgres.PostgresType>> = {},
) {
  return postgres(url, {
    ...opcoes,
    connection: { ...opcoes.connection, TimeZone: 'UTC' },
    types: {
      ...opcoes.types,
      timestamp: { from: [1114], parse: parseTimestampUtc },
    },
  })
}
