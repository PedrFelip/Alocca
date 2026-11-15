import {
  boolean,
  index,
  integer,
  pgTable,
  timestamp,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core'
import { usuariosTable } from './usuarios.ts'

export const desafiosMobileTable = pgTable(
  'desafios_mobile',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    usuario_id: uuid('usuario_id')
      .notNull()
      .references(() => usuariosTable.id),
    token_hash: varchar('token_hash', { length: 64 }).notNull().unique(),
    dispositivo_hash: varchar('dispositivo_hash', { length: 64 }),
    pin_hash: varchar('pin_hash', { length: 64 }),
    pin_enviado: boolean('pin_enviado').notNull().default(false),
    pin_expires_at: timestamp('pin_expires_at'),
    erros: integer('erros').notNull().default(0),
    expires_at: timestamp('expires_at').notNull(),
    used_at: timestamp('used_at'),
  },
  (t) => [
    index('desafios_mobile_usuario_idx').on(t.usuario_id),
    index('desafios_mobile_expira_idx').on(t.expires_at),
  ],
)
export const enviosPinTable = pgTable(
  'envios_pin',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    usuario_id: uuid('usuario_id')
      .notNull()
      .references(() => usuariosTable.id),
    created_at: timestamp('created_at').notNull().defaultNow(),
  },
  (t) => [
    index('envios_pin_usuario_data_idx').on(t.usuario_id, t.created_at),
    index('envios_pin_data_idx').on(t.created_at),
  ],
)
export const dispositivosConfiaveisTable = pgTable(
  'dispositivos_confiaveis',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    usuario_id: uuid('usuario_id')
      .notNull()
      .references(() => usuariosTable.id),
    token_hash: varchar('token_hash', { length: 64 }).notNull(),
    versao_sessao: integer('versao_sessao').notNull(),
    created_at: timestamp('created_at').notNull().defaultNow(),
  },
  (table) => [
    index('dispositivos_confiaveis_usuario_token_idx').on(
      table.usuario_id,
      table.token_hash,
    ),
  ],
)
export const sessoesMobileTable = pgTable(
  'sessoes_mobile',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    usuario_id: uuid('usuario_id')
      .notNull()
      .references(() => usuariosTable.id),
    expires_at: timestamp('expires_at').notNull(),
    revoked_at: timestamp('revoked_at'),
  },
  (t) => [
    index('sessoes_mobile_usuario_idx').on(t.usuario_id),
    index('sessoes_mobile_expira_idx').on(t.expires_at),
  ],
)
export const refreshMobileTable = pgTable(
  'refresh_mobile',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    sessao_id: uuid('sessao_id')
      .notNull()
      .references(() => sessoesMobileTable.id),
    token_hash: varchar('token_hash', { length: 64 }).notNull().unique(),
    used_at: timestamp('used_at'),
  },
  (t) => [index('refresh_mobile_sessao_idx').on(t.sessao_id)],
)
