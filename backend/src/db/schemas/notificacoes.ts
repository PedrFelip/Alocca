import {
  index,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'
import { plantoesTable } from './plantoes.ts'
import { usuariosTable } from './usuarios.ts'

export const statusNotificacao = pgEnum('status_notificacao', [
  'PENDENTE',
  'ENVIADA',
])

/**
 * Caixa de saída de notificações (padrão outbox). Os eventos são gravados na
 * MESMA transação do fato que os originou (ex.: alocação UC11) e entregues
 * depois por um worker SMTP. Android sincroniza a inbox e notifica localmente
 * por WorkManager (D10); o status de e-mail não representa leitura no app.
 */
export const notificacoesTable = pgTable(
  'notificacoes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    usuario_destino_id: uuid('usuario_destino_id')
      .notNull()
      .references(() => usuariosTable.id),
    plantao_id: uuid('plantao_id')
      .notNull()
      .references(() => plantoesTable.id),
    // Ex.: 'ALOCACAO_APROVADA' | 'CANDIDATURA_REJEITADA'
    tipo: text('tipo').notNull(),
    status: statusNotificacao().notNull().default('PENDENTE'),
    created_at: timestamp('created_at').notNull().defaultNow(),
    enviada_at: timestamp('enviada_at'),
    processada_at: timestamp('processada_at'),
    lida_at: timestamp('lida_at'),
  },
  (table) => [
    // Fila de entrega: worker consome PENDENTE na ordem de criação.
    index('notificacoes_expansao_idx')
      .on(table.created_at, table.id)
      .where(
        sql`${table.processada_at} IS NULL AND ${table.status} = 'PENDENTE'`,
      ),
    index('notificacoes_fila_idx').on(table.status, table.created_at),
    index('notificacoes_usuario_destino_id_idx').on(table.usuario_destino_id),
    index('notificacoes_inbox_cursor_idx').on(
      table.usuario_destino_id,
      table.created_at.desc(),
      table.id.desc(),
    ),
    index('notificacoes_nao_lidas_idx')
      .on(table.usuario_destino_id)
      .where(sql`${table.lida_at} IS NULL`),
  ],
)
