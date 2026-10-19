import { numeric, pgTable, timestamp, unique, uuid } from 'drizzle-orm/pg-core'
import { alocacoesTable } from './alocacoes.js'

export const registrosPontoTable = pgTable(
  'registros_ponto',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    alocacao_id: uuid('alocacao_id')
      .notNull()
      .references(() => alocacoesTable.id),
    check_in_at: timestamp('check_in_at'),
    check_out_at: timestamp('check_out_at'),
    // Coordenadas nulas quando o GPS é negado ou a geolocalização não é permitida (LGPD).
    check_in_latitude: numeric('check_in_latitude', { precision: 9, scale: 6 }),
    check_in_longitude: numeric('check_in_longitude', {
      precision: 9,
      scale: 6,
    }),
    check_out_latitude: numeric('check_out_latitude', {
      precision: 9,
      scale: 6,
    }),
    check_out_longitude: numeric('check_out_longitude', {
      precision: 9,
      scale: 6,
    }),
    created_at: timestamp('created_at').notNull().defaultNow(),
    updated_at: timestamp('updated_at')
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    // Uma linha por alocação, guardando check-in e check-out juntos.
    unique('registros_ponto_alocacao_unique').on(table.alocacao_id),
  ],
)
