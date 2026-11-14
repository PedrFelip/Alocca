import {
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core'
import { tokensRecuperacaoSenhaTable } from './tokens-recuperacao-senha.ts'

/** Payload autenticado e cifrado; removido após entrega ou expiração. */
export const emailsPendentesTable = pgTable(
  'emails_pendentes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    token_id: uuid('token_id')
      .notNull()
      .references(() => tokensRecuperacaoSenhaTable.id, {
        onDelete: 'cascade',
      }),
    payload: text('payload').notNull(),
    tentativas: integer('tentativas').notNull().default(0),
    disponivel_em: timestamp('disponivel_em').notNull().defaultNow(),
  },
  (table) => [index('emails_pendentes_fila_idx').on(table.disponivel_em)],
)
