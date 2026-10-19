import { boolean, pgTable, timestamp, uuid, varchar } from 'drizzle-orm/pg-core'
import { usuariosTable } from './usuarios.js'

export const gestoresTable = pgTable('gestores', {
  id: uuid('id').primaryKey().defaultRandom(),
  usuario_id: uuid('usuario_id')
    .notNull()
    .unique()
    .references(() => usuariosTable.id),
  cargo: varchar('cargo', { length: 100 }),
  ativa: boolean('ativa').notNull().default(true),
  created_at: timestamp('created_at').notNull().defaultNow(),
  updated_at: timestamp('updated_at')
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
  deleted_at: timestamp('deleted_at'),
})
