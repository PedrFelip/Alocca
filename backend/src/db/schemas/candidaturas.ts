import {
  index,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core'
import { gestoresTable } from './gestores.ts'
import { medicosTable } from './medicos.ts'
import { plantoesTable } from './plantoes.ts'

export const statusCandidatura = pgEnum('status_candidatura', [
  'PENDENTE',
  'APROVADA',
  'REJEITADA',
])

export const candidaturasTable = pgTable(
  'candidaturas',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    plantao_id: uuid('plantao_id')
      .notNull()
      .references(() => plantoesTable.id),
    medico_id: uuid('medico_id')
      .notNull()
      .references(() => medicosTable.id),
    status: statusCandidatura().notNull().default('PENDENTE'),
    mensagem_medico: text('mensagem_medico'),
    observacao_gestor: text('observacao_gestor'),
    analisado_por_gestor_id: uuid('analisado_por_gestor_id').references(
      () => gestoresTable.id,
    ),
    analisado_at: timestamp('analisado_at'),
    created_at: timestamp('created_at').notNull().defaultNow(),
    updated_at: timestamp('updated_at')
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
    deleted_at: timestamp('deleted_at'),
  },
  (table) => [
    // Um médico não pode candidatar-se duas vezes ao mesmo plantão.
    unique('candidaturas_plantao_medico_unique').on(
      table.plantao_id,
      table.medico_id,
    ),
    // Alvo da FK composta de alocacoes: garante que plantão/médico batem com a candidatura.
    unique('candidaturas_id_plantao_medico_unique').on(
      table.id,
      table.plantao_id,
      table.medico_id,
    ),
    index('candidaturas_plantao_id_idx').on(table.plantao_id),
    index('candidaturas_medico_id_idx').on(table.medico_id),
  ],
)
