import 'dotenv/config'
import { setTimeout } from 'node:timers/promises'
import { drizzle } from 'drizzle-orm/postgres-js'
import { validateEnv } from '../config/env.ts'
import { criarClientePostgres } from '../db/cliente-postgres.ts'
import { CanalSmtp } from './entrega/smtp.ts'
import { RepositorioEntregas } from './entrega/repositorio.ts'
import { WorkerNotificacoes } from './entrega/worker.ts'

const env = validateEnv(process.env)
const cliente = criarClientePostgres(env.DATABASE_URL, { max: 4 })
const repo = new RepositorioEntregas(drizzle({ client: cliente }))
const worker = new WorkerNotificacoes(
  repo,
  {
    email: new CanalSmtp(env),
  },
  env.NOTIFICATIONS_CONCURRENCY,
)
const parada = new AbortController()
process.once('SIGTERM', () => parada.abort())
process.once('SIGINT', () => parada.abort())
let ultimaMetrica = 0
try {
  while (!parada.signal.aborted) {
    let processadas = 0
    try {
      processadas = await worker.ciclo()
      if (Date.now() - ultimaMetrica > 60_000) {
        console.log(
          JSON.stringify({
            evento: 'NOTIFICACAO_FILA',
            estados: await repo.metricas(),
            outbox: await repo.metricasOutbox(),
          }),
        )
        ultimaMetrica = Date.now()
      }
    } catch {
      // Não serializar exceções de SQL ou provedores: podem conter segredos/PII.
      console.error(JSON.stringify({ evento: 'NOTIFICACAO_WORKER_ERRO' }))
    }
    if (!processadas)
      await setTimeout(env.NOTIFICATIONS_POLL_MS, undefined, {
        signal: parada.signal,
      }).catch(() => {})
  }
} finally {
  worker.fechar()
  await cliente.end({ timeout: 5 })
}
