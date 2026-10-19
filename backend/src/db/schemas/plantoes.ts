import { sql } from 'drizzle-orm'
import {
  boolean,
  check,
  index,
  integer,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core'
import { gestoresTable } from './gestores.js'
import { instituicoesTable } from './instituicoes.js'

export const statusPlantao = pgEnum('status_plantao', [
  'RASCUNHO',
  'ABERTO',
  'PREENCHIDO',
  'EM_ANDAMENTO',
  'CONCLUIDO',
  'CANCELADO',
])

export const plantoesTable = pgTable(
  'plantoes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    instituicao_id: uuid('instituicao_id')
      .notNull()
      .references(() => instituicoesTable.id),
    criado_por_gestor_id: uuid('criado_por_gestor_id')
      .notNull()
      .references(() => gestoresTable.id),
    titulo: varchar('titulo', { length: 150 }).notNull(),
    descricao: text('descricao'),
    especialidade: varchar('especialidade', { length: 100 }),
    data_inicio: timestamp('data_inicio').notNull(),
    data_fim: timestamp('data_fim').notNull(),
    valor: numeric('valor', { precision: 10, scale: 2 }).notNull(),
    quantidade_vagas: integer('quantidade_vagas').notNull(),
    // Controlado por decremento atômico na confirmação da alocação.
    vagas_disponiveis: integer('vagas_disponiveis').notNull(),
    status: statusPlantao().notNull().default('RASCUNHO'),
    permite_candidatura: boolean('permite_candidatura').notNull().default(true),
    exige_checkin: boolean('exige_checkin').notNull().default(true),
    permite_geolocalizacao: boolean('permite_geolocalizacao')
      .notNull()
      .default(true),
    created_at: timestamp('created_at').notNull().defaultNow(),
    updated_at: timestamp('updated_at')
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
    deleted_at: timestamp('deleted_at'),
  },
  (table) => [
    // Feed do médico: apenas abertos que aceitam candidatura.
    index('plantoes_status_candidatura_idx').on(
      table.status,
      table.permite_candidatura,
    ),
    index('plantoes_instituicao_id_idx').on(table.instituicao_id),
    index('plantoes_data_inicio_idx').on(table.data_inicio),
    index('plantoes_especialidade_idx').on(table.especialidade),
    check(
      'plantoes_quantidade_vagas_check',
      sql`${table.quantidade_vagas} >= 1`,
    ),
    check(
      'plantoes_vagas_disponiveis_check',
      sql`${table.vagas_disponiveis} >= 0 and ${table.vagas_disponiveis} <= ${table.quantidade_vagas}`,
    ),
    check(
      'plantoes_periodo_check',
      sql`${table.data_fim} > ${table.data_inicio}`,
    ),
  ],
)
