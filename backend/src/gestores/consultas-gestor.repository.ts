import { Inject, Injectable } from '@nestjs/common'
import { and, asc, desc, eq, isNull, sql } from 'drizzle-orm'
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

  medicos(gestorId: string, limit: number, offset: number) {
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
      .where(this.escopo(gestorId))
      .orderBy(asc(usuarios.nome), asc(medicos.id))
      .limit(limit)
      .offset(offset)
  }

  ponto(gestorId: string, limit: number, offset: number) {
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
      .where(this.escopo(gestorId))
      .orderBy(desc(pontos.timestamp_servidor), desc(pontos.id))
      .limit(limit)
      .offset(offset)
  }
}
