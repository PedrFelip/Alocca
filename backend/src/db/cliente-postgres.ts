import postgres from 'postgres'

// as colunas sao timestamp sem fuso: o now() do banco usa o fuso da sessao,
// entao a sessao fica sempre em UTC, nao importa o fuso do servidor (#77)
export function criarClientePostgres(
  url: string,
  opcoes: postgres.Options<Record<string, postgres.PostgresType>> = {},
) {
  return postgres(url, {
    ...opcoes,
    connection: { ...opcoes.connection, TimeZone: 'UTC' },
  })
}
