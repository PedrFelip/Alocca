import { pgTable, timestamp, uuid, varchar } from 'drizzle-orm/pg-core'
import { usuariosTable } from './usuarios.js'

export const tokensRecuperacaoSenhaTable = pgTable('tokens_recuperacao_senha', {
  id: uuid('id').primaryKey().defaultRandom(),
  usuario_id: uuid('usuario_id')
    .notNull()
    .references(() => usuariosTable.id),
  // Armazenar apenas o hash do token de recuperação.
  token: varchar('token', { length: 255 }).notNull().unique(),
  expires_at: timestamp('expires_at').notNull(),
  used_at: timestamp('used_at'),
  created_at: timestamp('created_at').notNull().defaultNow(),
})
