import { integer, pgTable, timestamp, uuid, varchar } from 'drizzle-orm/pg-core'
import { usuariosTable } from './usuarios.ts'

export const desafiosMobileTable = pgTable('desafios_mobile', {
  id: uuid('id').primaryKey().defaultRandom(),
  usuario_id: uuid('usuario_id')
    .notNull()
    .references(() => usuariosTable.id),
  token_hash: varchar('token_hash', { length: 64 }).notNull().unique(),
  pin_hash: varchar('pin_hash', { length: 64 }),
  pin_expires_at: timestamp('pin_expires_at'),
  erros: integer('erros').notNull().default(0),
  expires_at: timestamp('expires_at').notNull(),
  used_at: timestamp('used_at'),
})
export const enviosPinTable = pgTable('envios_pin', {
  id: uuid('id').primaryKey().defaultRandom(),
  usuario_id: uuid('usuario_id')
    .notNull()
    .references(() => usuariosTable.id),
  created_at: timestamp('created_at').notNull().defaultNow(),
})
export const sessoesMobileTable = pgTable('sessoes_mobile', {
  id: uuid('id').primaryKey().defaultRandom(),
  usuario_id: uuid('usuario_id')
    .notNull()
    .references(() => usuariosTable.id),
  expires_at: timestamp('expires_at').notNull(),
  revoked_at: timestamp('revoked_at'),
})
export const refreshMobileTable = pgTable('refresh_mobile', {
  id: uuid('id').primaryKey().defaultRandom(),
  sessao_id: uuid('sessao_id')
    .notNull()
    .references(() => sessoesMobileTable.id),
  token_hash: varchar('token_hash', { length: 64 }).notNull().unique(),
  used_at: timestamp('used_at'),
})
