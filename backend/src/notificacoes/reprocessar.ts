import 'dotenv/config'
import { z } from 'zod'
import { criarClientePostgres } from '../db/cliente-postgres.ts'
import { validateEnv } from '../config/env.ts'

// Operação explícita por ID; nunca reenvia uma entrega já aceita.
const id = z.uuid().parse(process.argv[2])
const env = validateEnv(process.env)
const pg = criarClientePostgres(env.DATABASE_URL, { max: 1 })
try {
  const rows =
    await pg`UPDATE entregas_notificacao SET estado='PENDENTE', tentativas=0,
    proxima_at=now(), erro_codigo=NULL WHERE id=${id} AND estado IN ('BLOQUEADA','FALHOU') RETURNING id`
  console.log(
    JSON.stringify({
      evento: 'NOTIFICACAO_REPROCESSADA',
      entrega_id: id,
      alteradas: rows.length,
    }),
  )
} finally {
  await pg.end()
}
