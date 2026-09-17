import { pgEnum, pgTable, timestamp, uuid, varchar } from 'drizzle-orm/pg-core'

export const TipoUsuario = pgEnum('tipo_usuario', [
  'admin',
  'instituicao',
  'gestor',
  'medico',
])

export const StatusUsuario = pgEnum('status_usuario', [
  'ativo',
  'inativo',
  'bloqueado',
])

export const usuariosTable = pgTable('usuarios', {
  id: uuid('id').primaryKey().defaultRandom(),
  nome: varchar('nome', { length: 255 }).notNull(),
  email: varchar('email', { length: 255 }).unique().notNull(),
  senha_hash: varchar('senha_hash', { length: 255 }).notNull(),
  telefone: varchar('telefone', { length: 20 }),
  tipo: TipoUsuario().default('medico'),
  status: StatusUsuario().default('ativo'),
  ultimo_login_at: timestamp('ultimo_login_at'),
  created_at: timestamp('created_at').notNull().defaultNow(),
  updated_at: timestamp('updated_at').notNull().defaultNow(),
  deleted_at: timestamp('deleted_at'),
})
