import {
  pgEnum,
  pgTable,
  timestamp,
  unique,
  uuid,
  varchar,
  char,
} from 'drizzle-orm/pg-core'
import { usuariosTable } from './usuarios.ts'

export const statusValidacaoMedico = pgEnum('status_validacao_medico', [
  'PENDENTE',
  'APROVADO',
  'REJEITADO',
])

export const medicosTable = pgTable(
  'medicos',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    usuario_id: uuid('usuario_id')
      .notNull()
      .unique()
      .references(() => usuariosTable.id),
    crm: varchar('crm', { length: 20 }).notNull(),
    uf_crm: char('uf_crm', { length: 2 }).notNull(),
    especialidade: varchar('especialidade', { length: 100 }),
    status_validacao: statusValidacaoMedico().notNull().default('PENDENTE'),
    validado_por_usuario_id: uuid('validado_por_usuario_id').references(
      () => usuariosTable.id,
    ),
    validado_at: timestamp('validado_at'),
    motivo_rejeicao: varchar('motivo_rejeicao', { length: 500 }),
    created_at: timestamp('created_at').notNull().defaultNow(),
    updated_at: timestamp('updated_at')
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
    deleted_at: timestamp('deleted_at'),
  },
  (table) => [unique('medicos_crm_uf_crm_unique').on(table.crm, table.uf_crm)],
)
