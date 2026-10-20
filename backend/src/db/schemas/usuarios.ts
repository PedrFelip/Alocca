import {
  integer,
  pgEnum,
  pgTable,
  timestamp,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core'

export const TipoUsuario = pgEnum('tipo_usuario', ['MEDICO', 'GESTOR', 'ADMIN'])

export const StatusUsuario = pgEnum('status_usuario', [
  'ATIVO',
  'INATIVO',
  'BLOQUEADO',
])

export const usuariosTable = pgTable('usuarios', {
  id: uuid('id').primaryKey().defaultRandom(),
  nome: varchar('nome', { length: 150 }).notNull(),
  email: varchar('email', { length: 255 }).unique().notNull(),
  senha_hash: varchar('senha_hash', { length: 255 }).notNull(),
  telefone: varchar('telefone', { length: 20 }),
  tipo: TipoUsuario().notNull(),
  status: StatusUsuario().notNull().default('ATIVO'),
  tentativas_falhas: integer('tentativas_falhas').notNull().default(0),
  bloqueado_ate: timestamp('bloqueado_ate'),
  ultimo_login_at: timestamp('ultimo_login_at'),
  created_at: timestamp('created_at').notNull().defaultNow(),
  updated_at: timestamp('updated_at')
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
  deleted_at: timestamp('deleted_at'),
})
