import {
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core'
import { alocacoesTable } from './alocacoes.ts'
import { gestoresTable } from './gestores.ts'

export const statusPagamento = pgEnum('status_pagamento', ['PENDENTE', 'PAGO'])

export const pagamentosTable = pgTable(
  'pagamentos',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    alocacao_id: uuid('alocacao_id')
      .notNull()
      .references(() => alocacoesTable.id),
    valor: numeric('valor', { precision: 10, scale: 2 }).notNull(),
    status: statusPagamento().notNull().default('PENDENTE'),
    vencimento_em: timestamp('vencimento_em'),
    pago_at: timestamp('pago_at'),
    observacoes: text('observacoes'),
    registrado_por_gestor_id: uuid('registrado_por_gestor_id').references(
      () => gestoresTable.id,
    ),
    created_at: timestamp('created_at').notNull().defaultNow(),
    updated_at: timestamp('updated_at')
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
    deleted_at: timestamp('deleted_at'),
  },
  (table) => [unique('pagamentos_alocacao_unique').on(table.alocacao_id)],
)
