import {
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core'
import { plantoesTable } from './plantoes.ts'
import { usuariosTable } from './usuarios.ts'

export const statusNotificacao = pgEnum('status_notificacao', [
  'PENDENTE',
  'ENVIADA',
])

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
    lida_em: timestamp('lida_em'),
    tentativas: integer('tentativas').notNull().default(0),
    disponivel_em: timestamp('disponivel_em').notNull().defaultNow(),
  },
  (table) => [
    // Fila de entrega: worker consome PENDENTE na ordem de criação.
    index('notificacoes_fila_idx').on(table.status, table.created_at),
    index('notificacoes_usuario_destino_id_idx').on(table.usuario_destino_id),
  ],
)
