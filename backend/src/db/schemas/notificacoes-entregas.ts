import {
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'
import { notificacoesTable } from './notificacoes.ts'

export const entregasNotificacaoTable = pgTable(
  'entregas_notificacao',
  {
    id: uuid().primaryKey().defaultRandom(),
    notificacao_id: uuid()
      .notNull()
      .references(() => notificacoesTable.id, { onDelete: 'cascade' }),
    canal: text().notNull(),
    // Destino lógico 'email'; resolve endereço atual no envio, sem duplicar PII.
    destino: text().notNull(),
    estado: text().notNull().default('PENDENTE'),
    tentativas: integer().notNull().default(0),
    proxima_at: timestamp().notNull().defaultNow(),
    lease_id: uuid(),
    lease_ate: timestamp(),
    erro_codigo: text(),
    enviada_at: timestamp(),
  },
  (t) => [
    uniqueIndex('entregas_destino_unique').on(
      t.notificacao_id,
      t.canal,
      t.destino,
    ),
    index('entregas_fila_idx').on(t.estado, t.proxima_at),
    index('entregas_lease_idx').on(t.estado, t.lease_ate),
  ],
)
