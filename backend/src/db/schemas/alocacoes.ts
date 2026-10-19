import { sql } from 'drizzle-orm'
import {
  index,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'
import { candidaturasTable } from './candidaturas.js'
import { gestoresTable } from './gestores.js'
import { medicosTable } from './medicos.js'
import { plantoesTable } from './plantoes.js'

export const origemAlocacao = pgEnum('origem_alocacao', [
  'CANDIDATURA',
  'ATRIBUICAO_DIRETA',
])

export const statusAlocacao = pgEnum('status_alocacao', [
  'PENDENTE',
  'CONFIRMADA',
  'CANCELADA',
  'CONCLUIDA',
])

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
    // Nulo apenas na atribuição direta (sem candidatura de origem).
    candidatura_id: uuid('candidatura_id').references(
      () => candidaturasTable.id,
    ),
    atribuido_por_gestor_id: uuid('atribuido_por_gestor_id').references(
      () => gestoresTable.id,
    ),
    origem: origemAlocacao().notNull(),
    status: statusAlocacao().notNull().default('PENDENTE'),
    confirmado_at: timestamp('confirmado_at'),
    cancelado_at: timestamp('cancelado_at'),
    motivo_cancelamento: text('motivo_cancelamento'),
    created_at: timestamp('created_at').notNull().defaultNow(),
    updated_at: timestamp('updated_at')
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
    deleted_at: timestamp('deleted_at'),
  },
  (table) => [
    // Uma alocação por candidatura (quando houver candidatura de origem).
    uniqueIndex('alocacoes_candidatura_unique')
      .on(table.candidatura_id)
      .where(sql`${table.candidatura_id} is not null`),
    index('alocacoes_plantao_id_idx').on(table.plantao_id),
    index('alocacoes_medico_id_idx').on(table.medico_id),
  ],
)
