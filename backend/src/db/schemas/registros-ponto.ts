import {
  doublePrecision,
  pgEnum,
  pgTable,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core'
import { alocacoesTable } from './alocacoes.js'

export const tipoEventoPresenca = pgEnum('tipo_evento_presenca', [
  'ENTRADA',
  'SAIDA',
])

export const registrosPontoTable = pgTable(
  'registros_ponto',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    alocacao_id: uuid('alocacao_id')
      .notNull()
      .references(() => alocacoesTable.id),
    tipo_evento: tipoEventoPresenca().notNull(),
    timestamp_servidor: timestamp('timestamp_servidor').notNull().defaultNow(),
    // Coordenadas nulas quando o GPS é negado ou a geolocalização não é permitida (LGPD).
    latitude: doublePrecision('latitude'),
    longitude: doublePrecision('longitude'),
    precisao_metros: doublePrecision('precisao_metros'),
    distancia_local: doublePrecision('distancia_local'),
    created_at: timestamp('created_at').notNull().defaultNow(),
    updated_at: timestamp('updated_at')
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    // No máximo um registro por evento (entrada/saída) em cada alocação.
    unique('registros_ponto_alocacao_evento_unique').on(
      table.alocacao_id,
      table.tipo_evento,
    ),
  ],
)
