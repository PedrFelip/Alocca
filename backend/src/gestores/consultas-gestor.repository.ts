import { Inject, Injectable } from '@nestjs/common'
import { and, asc, desc, eq, gte, lt, or, isNull, sql } from 'drizzle-orm'
import { DRIZZLE_DB, type Database } from '../db/db.provider.ts'
import {
  alocacoesTable as alocacoes,
  gestoresInstituicoesTable as vinculos,
  instituicoesTable as instituicoes,
  medicosTable as medicos,
  plantoesTable as plantoes,
  registrosPontoTable as pontos,
  usuariosTable as usuarios,
} from '../db/schemas/index.ts'

import type {
  ConsultaMedicos,
  ConsultaPonto,
} from './consultas-gestor.schemas.ts'

// Escape LIKE metacharacters so searches are literal substrings.
function substring(valor: string) {
  return `%${valor.replace(/[\\%_]/g, '\\$&')}%`
}

@Injectable()
export class ConsultasGestorRepository {
  constructor(@Inject(DRIZZLE_DB) private readonly db: Database) {}

  private escopo(gestorId: string) {
    return and(
      eq(vinculos.gestor_id, gestorId),
      eq(instituicoes.ativa, true),
      isNull(instituicoes.deleted_at),
      isNull(plantoes.deleted_at),
      isNull(alocacoes.deleted_at),
      isNull(medicos.deleted_at),
      isNull(usuarios.deleted_at),
    )
  }

  medicos(gestorId: string, filtros: ConsultaMedicos) {
    return this.db
      .selectDistinct({
        id: medicos.id,
        nome: usuarios.nome,
        crm: medicos.crm,
        uf_crm: medicos.uf_crm,
        especialidade: medicos.especialidade,
        status: usuarios.status,
        status_validacao: medicos.status_validacao,
      })
      .from(alocacoes)
      .innerJoin(plantoes, eq(alocacoes.plantao_id, plantoes.id))
      .innerJoin(instituicoes, eq(plantoes.instituicao_id, instituicoes.id))
      .innerJoin(vinculos, eq(vinculos.instituicao_id, instituicoes.id))
      .innerJoin(medicos, eq(alocacoes.medico_id, medicos.id))
      .innerJoin(usuarios, eq(medicos.usuario_id, usuarios.id))
      .where(
        and(
          this.escopo(gestorId),
          filtros.instituicao_id
            ? eq(instituicoes.id, filtros.instituicao_id)
            : undefined,
          filtros.q
            ? or(
                ...[usuarios.nome, medicos.crm, medicos.especialidade].map(
                  (coluna) =>
                    sql`${coluna} ilike ${substring(filtros.q!)} escape '\\'`,
                ),
              )
            : undefined,
          filtros.especialidade
            ? sql`${medicos.especialidade} ilike ${substring(filtros.especialidade)} escape '\\'`
            : undefined,
          filtros.status ? eq(usuarios.status, filtros.status) : undefined,
          filtros.status_validacao
            ? eq(medicos.status_validacao, filtros.status_validacao)
            : undefined,
          filtros.uf_crm ? eq(medicos.uf_crm, filtros.uf_crm) : undefined,
        ),
      )
      .orderBy(asc(usuarios.nome), asc(medicos.id))
      .limit(filtros.limit)
      .offset(filtros.offset)
  }

  ponto(gestorId: string, filtros: ConsultaPonto) {
    return this.db
      .select({
        id: pontos.id,
        tipo_evento: pontos.tipo_evento,
        timestamp_servidor: pontos.timestamp_servidor,
        com_localizacao: sql<boolean>`(${pontos.latitude} is not null)`,
        medico: {
          id: medicos.id,
          nome: usuarios.nome,
          crm: medicos.crm,
          uf_crm: medicos.uf_crm,
        },
        plantao: { id: plantoes.id, titulo: plantoes.titulo },
        instituicao: { id: instituicoes.id, nome: instituicoes.nome },
      })
      .from(pontos)
      .innerJoin(alocacoes, eq(pontos.alocacao_id, alocacoes.id))
      .innerJoin(plantoes, eq(alocacoes.plantao_id, plantoes.id))
      .innerJoin(instituicoes, eq(plantoes.instituicao_id, instituicoes.id))
      .innerJoin(vinculos, eq(vinculos.instituicao_id, instituicoes.id))
      .innerJoin(medicos, eq(alocacoes.medico_id, medicos.id))
      .innerJoin(usuarios, eq(medicos.usuario_id, usuarios.id))
      .where(
        and(
          this.escopo(gestorId),
          filtros.instituicao_id
            ? eq(instituicoes.id, filtros.instituicao_id)
            : undefined,
          filtros.medico_id ? eq(medicos.id, filtros.medico_id) : undefined,
          filtros.tipo_evento
            ? eq(pontos.tipo_evento, filtros.tipo_evento)
            : undefined,
          filtros.inicio
            ? gte(pontos.timestamp_servidor, new Date(filtros.inicio))
            : undefined,
          filtros.fim
            ? lt(pontos.timestamp_servidor, new Date(filtros.fim))
            : undefined,
        ),
      )
      .orderBy(desc(pontos.timestamp_servidor), desc(pontos.id))
      .limit(filtros.limit)
      .offset(filtros.offset)
  }
}
