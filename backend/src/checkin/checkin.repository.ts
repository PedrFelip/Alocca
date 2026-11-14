import { Inject, Injectable } from '@nestjs/common'
import {
  and,
  asc,
  eq,
  exists,
  gte,
  isNull,
  ne,
  notExists,
  sql,
} from 'drizzle-orm'
import { DRIZZLE_DB, type Database } from '../db/db.provider.ts'
import {
  alocacoesTable,
  instituicoesTable,
  plantoesTable,
  registrosPontoTable,
} from '../db/schemas/index.ts'
import type { RegistrarPresenca } from './checkin.schemas.ts'
import { DEPOIS_DO_FIM } from './horario.ts'

// o POST e o GET usam os mesmos filtros pra nunca discordarem
function alocacaoAtivaDoMedico(medicoId: string) {
  return [
    eq(alocacoesTable.medico_id, medicoId),
    isNull(alocacoesTable.deleted_at),
    isNull(plantoesTable.deleted_at),
    isNull(instituicoesTable.deleted_at),
  ]
}

type TransacaoCheckin = Parameters<Parameters<Database['transaction']>[0]>[0]

@Injectable()
export class CheckinRepository {
  constructor(@Inject(DRIZZLE_DB) private readonly db: Database) {}
  alocacaoDoMedico(tx: TransacaoCheckin, medicoId: string, alocacaoId: string) {
    return tx
      .select({
        status_plantao: plantoesTable.status,
        exige_checkin: plantoesTable.exige_checkin,
        data_inicio: plantoesTable.data_inicio,
        data_fim: plantoesTable.data_fim,
        permite_geolocalizacao: plantoesTable.permite_geolocalizacao,
        hospital_lat: instituicoesTable.latitude,
        hospital_lon: instituicoesTable.longitude,
      })
      .from(alocacoesTable)
      .innerJoin(plantoesTable, eq(alocacoesTable.plantao_id, plantoesTable.id))
      .innerJoin(
        instituicoesTable,
        eq(plantoesTable.instituicao_id, instituicoesTable.id),
      )
      .where(
        and(
          eq(alocacoesTable.id, alocacaoId),
          ...alocacaoAtivaDoMedico(medicoId),
        ),
      )
      .for('update', { of: plantoesTable })
      .limit(1)
  }
  entrada(tx: TransacaoCheckin, alocacaoId: string) {
    return tx
      .select({ id: registrosPontoTable.id })
      .from(registrosPontoTable)
      .where(
        and(
          eq(registrosPontoTable.alocacao_id, alocacaoId),
          eq(registrosPontoTable.tipo_evento, 'ENTRADA'),
        ),
      )
      .limit(1)
  }
  inserir(
    tx: TransacaoCheckin,
    dados: RegistrarPresenca,
    gps: {
      latitude: number | null
      longitude: number | null
      precisao: number | null
      distancia: number | null
    },
  ) {
    return tx
      .insert(registrosPontoTable)
      .values({
        alocacao_id: dados.alocacao_id,
        tipo_evento: dados.tipo_evento,
        latitude: gps.latitude,
        longitude: gps.longitude,
        precisao_metros: gps.precisao,
        distancia_local: gps.distancia,
      })
      .returning({
        id: registrosPontoTable.id,
        tipo_evento: registrosPontoTable.tipo_evento,
        timestamp_servidor: registrosPontoTable.timestamp_servidor,
        distancia_local: registrosPontoTable.distancia_local,
      })
  }
  proximos(medicoId: string, agora: Date) {
    const registro = (tipo: 'ENTRADA' | 'SAIDA') =>
      this.db
        .select({ um: sql`1` })
        .from(registrosPontoTable)
        .where(
          and(
            eq(registrosPontoTable.alocacao_id, alocacoesTable.id),
            eq(registrosPontoTable.tipo_evento, tipo),
          ),
        )

    // o banco so corta o que ja passou do prazo, quem decide o resto
    // sao as mesmas funcoes do POST (horario.ts)
    return this.db
      .select({
        alocacao_id: alocacoesTable.id,
        checkin_feito: sql<boolean>`${exists(registro('ENTRADA'))}`,
        plantao: {
          id: plantoesTable.id,
          titulo: plantoesTable.titulo,
          especialidade: plantoesTable.especialidade,
          local_unidade: plantoesTable.local_unidade,
          data_inicio: plantoesTable.data_inicio,
          data_fim: plantoesTable.data_fim,
        },
        instituicao: {
          id: instituicoesTable.id,
          nome: instituicoesTable.nome,
          cidade: instituicoesTable.cidade,
          uf: instituicoesTable.uf,
        },
      })
      .from(alocacoesTable)
      .innerJoin(plantoesTable, eq(alocacoesTable.plantao_id, plantoesTable.id))
      .innerJoin(
        instituicoesTable,
        eq(plantoesTable.instituicao_id, instituicoesTable.id),
      )
      .where(
        and(
          ...alocacaoAtivaDoMedico(medicoId),
          ne(plantoesTable.status, 'CANCELADO'),
          eq(plantoesTable.exige_checkin, true),
          notExists(registro('SAIDA')),
          gte(
            plantoesTable.data_fim,
            new Date(agora.getTime() - DEPOIS_DO_FIM),
          ),
        ),
      )
      .orderBy(asc(plantoesTable.data_inicio), asc(alocacoesTable.id))
  }
}
