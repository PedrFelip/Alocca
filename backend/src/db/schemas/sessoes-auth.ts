import { index, pgTable, timestamp, uuid, varchar } from 'drizzle-orm/pg-core'
import { usuariosTable } from './usuarios.ts'

export const sessoesAuthTable = pgTable(
  'sessoes_auth',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    usuario_id: uuid('usuario_id')
      .notNull()
      .references(() => usuariosTable.id),
    token_hash: varchar('token_hash', { length: 64 }).notNull().unique(),
    expires_at: timestamp('expires_at', { withTimezone: true }).notNull(),
    revogado_at: timestamp('revogado_at', { withTimezone: true }),
    created_at: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [index('sessoes_auth_usuario_id_idx').on(table.usuario_id)],
)
