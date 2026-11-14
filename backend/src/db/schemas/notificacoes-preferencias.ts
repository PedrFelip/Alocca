import { boolean, pgTable, uuid } from 'drizzle-orm/pg-core'
import { usuariosTable } from './usuarios.ts'

export const preferenciasNotificacaoTable = pgTable(
  'preferencias_notificacao',
  {
    usuario_id: uuid('usuario_id')
      .primaryKey()
      .references(() => usuariosTable.id),
    push: boolean('push').notNull().default(false),
    email: boolean('email').notNull().default(false),
  },
)
