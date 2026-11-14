import postgres from 'postgres'
import { criarClientePostgres } from '../src/db/cliente-postgres.ts'

// #77: as colunas sao timestamp sem fuso, entao o now() do banco depende do
// fuso da sessao. aqui o banco fica em Sao Paulo pra ver se a conexao do back
// continua em UTC

const URL_ADMIN =
  process.env.E2E_PG_ADMIN ??
  'postgresql://postgres:postgres@127.0.0.1:5432/postgres'

let disponivel = false
try {
  const sonda = postgres(URL_ADMIN, { max: 1, connect_timeout: 3 })
  await sonda`select 1`
  await sonda.end()
  disponivel = true
} catch {
  // sem postgres de verdade (pglite nao serve aqui): pula
}

const describeFuso = disponivel ? describe : describe.skip

describeFuso('Fuso da conexão com o banco (#77)', () => {
  const nomeBanco = `alocca_e2e_fuso_${Date.now().toString(36)}`
  const urlBanco = URL_ADMIN.replace(/\/postgres$/, `/${nomeBanco}`)
  let admin: postgres.Sql
  let semUtc: postgres.Sql
  let doBack: postgres.Sql

  beforeAll(async () => {
    admin = postgres(URL_ADMIN, { max: 1 })
    await admin.unsafe(`CREATE DATABASE ${nomeBanco}`)
    // simula vps/banco configurado no horario de brasilia
    await admin.unsafe(
      `ALTER DATABASE ${nomeBanco} SET timezone TO 'America/Sao_Paulo'`,
    )
    semUtc = postgres(urlBanco, { max: 1 })
    doBack = criarClientePostgres(urlBanco, { max: 1 })
    await doBack`CREATE TABLE registro (
      criado_em timestamp NOT NULL DEFAULT now(),
      fim timestamp
    )`
  }, 30000)

  afterAll(async () => {
    await semUtc?.end()
    await doBack?.end()
    await admin?.unsafe(`DROP DATABASE IF EXISTS ${nomeBanco} WITH (FORCE)`)
    await admin?.end()
  })

  beforeEach(async () => {
    await doBack`TRUNCATE registro`
  })

  it('o banco de teste está mesmo em São Paulo', async () => {
    const [linha] = await semUtc`SHOW TimeZone`
    expect(linha.TimeZone).toBe('America/Sao_Paulo')
  })

  it('a conexão do back fica em UTC', async () => {
    const [linha] = await doBack`SHOW TimeZone`
    expect(linha.TimeZone).toBe('UTC')
  })

  // le como o drizzle le: o texto da coluna tratado como UTC
  async function criadoEm(): Promise<number> {
    const [linha] = await doBack`SELECT criado_em::text AS t FROM registro`
    return new Date(`${(linha.t as string).replace(' ', 'T')}Z`).getTime()
  }

  it('defaultNow grava a hora certa (não 3h atrasada)', async () => {
    await doBack`INSERT INTO registro DEFAULT VALUES`
    const diferencaMin = Math.abs((await criadoEm()) - Date.now()) / 60_000
    expect(diferencaMin).toBeLessThan(1)
  })

  it('sem UTC o defaultNow ficaria 3h errado (o bug da issue)', async () => {
    await semUtc`INSERT INTO registro DEFAULT VALUES`
    const diferencaH = (Date.now() - (await criadoEm())) / 3_600_000
    expect(Math.round(diferencaH)).toBe(3)
  })

  it('plantão que acabou há 1h não aparece como futuro no now()', async () => {
    // mesmo filtro do feed: data_fim >= now()
    const umaHoraAtras = new Date(Date.now() - 3_600_000)
    await doBack`INSERT INTO registro (fim) VALUES (${umaHoraAtras})`
    const [doBackConta] = await doBack`
      SELECT count(*)::int AS total FROM registro WHERE fim >= now()`
    expect(doBackConta.total).toBe(0)
  })
})
