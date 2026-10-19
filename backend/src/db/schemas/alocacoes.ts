import {
  foreignKey,
  index,
  pgTable,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core'
import { candidaturasTable } from './candidaturas.js'
import { medicosTable } from './medicos.js'
import { plantoesTable } from './plantoes.js'

export const alocacoesTable = pgTable(
  'alocacoes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    plantao_id: uuid('plantao_id')
      .notNull()
      .references(() => plantoesTable.id),
    medico_id: uuid('medico_id')
      .notNull()
      .references(() => medicosTable.id),
    // Toda alocação nasce da aprovação de uma candidatura (spec: 1 — 0..1).
    candidatura_id: uuid('candidatura_id')
      .notNull()
      .references(() => candidaturasTable.id),
    confirmado_at: timestamp('confirmado_at').notNull().defaultNow(),
    created_at: timestamp('created_at').notNull().defaultNow(),
    updated_at: timestamp('updated_at')
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
    deleted_at: timestamp('deleted_at'),
  },
  (table) => [
    // Uma alocação por candidatura.
    unique('alocacoes_candidatura_unique').on(table.candidatura_id),
    // Garante que o plantão e o médico da alocação são os da candidatura referenciada.
    foreignKey({
      name: 'alocacoes_candidatura_vinculo_fkey',
      columns: [table.candidatura_id, table.plantao_id, table.medico_id],
      foreignColumns: [
        candidaturasTable.id,
        candidaturasTable.plantao_id,
        candidaturasTable.medico_id,
      ],
    }),
    index('alocacoes_plantao_id_idx').on(table.plantao_id),
    index('alocacoes_medico_id_idx').on(table.medico_id),
  ],
)
