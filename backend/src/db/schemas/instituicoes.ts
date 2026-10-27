import {
  boolean,
  char,
  index,
  pgTable,
  timestamp,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core'
import { usuariosTable } from './usuarios.ts'

export const instituicoesTable = pgTable(
  'instituicoes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    usuario_id: uuid('usuario_id')
      .notNull()
      .references(() => usuariosTable.id),
    nome: varchar('nome', { length: 200 }).notNull(),
    nome_fantasia: varchar('nome_fantasia', { length: 200 }),
    cnpj: varchar('cnpj', { length: 14 }).notNull().unique(),
    email: varchar('email', { length: 255 }),
    telefone: varchar('telefone', { length: 20 }),
    cep: varchar('cep', { length: 8 }),
    logradouro: varchar('logradouro', { length: 200 }),
    numero: varchar('numero', { length: 20 }),
    complemento: varchar('complemento', { length: 100 }),
    bairro: varchar('bairro', { length: 100 }),
    cidade: varchar('cidade', { length: 100 }),
    uf: char('uf', { length: 2 }),
    ativa: boolean('ativa').notNull().default(true),
    created_at: timestamp('created_at').notNull().defaultNow(),
    updated_at: timestamp('updated_at')
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
    deleted_at: timestamp('deleted_at'),
  },
  (table) => [index('instituicoes_usuario_id_idx').on(table.usuario_id)],
)
