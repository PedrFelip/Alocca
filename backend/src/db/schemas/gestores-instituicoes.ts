import {
  index,
  pgTable,
  primaryKey,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core'
import { gestoresTable } from './gestores.js'
import { instituicoesTable } from './instituicoes.js'

// Um gestor pode administrar várias instituições e vice-versa (spec: Gestor 1 — 0..* Instituicao).
export const gestoresInstituicoesTable = pgTable(
  'gestores_instituicoes',
  {
    gestor_id: uuid('gestor_id')
      .notNull()
      .references(() => gestoresTable.id),
    instituicao_id: uuid('instituicao_id')
      .notNull()
      .references(() => instituicoesTable.id),
    created_at: timestamp('created_at').notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.gestor_id, table.instituicao_id] }),
    index('gestores_instituicoes_instituicao_id_idx').on(table.instituicao_id),
  ],
)
