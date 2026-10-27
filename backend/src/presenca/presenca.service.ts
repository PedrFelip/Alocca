import { Inject, Injectable, NotFoundException } from '@nestjs/common'
import { and, desc, eq, isNull, sql } from 'drizzle-orm'
import { DRIZZLE_DB, type Database } from '../db/db.provider.ts'
import {
  alocacoesTable,
  instituicoesTable,
  medicosTable,
  plantoesTable,
  registrosPontoTable,
} from '../db/schemas/index.ts'
import type { ConsultarPresenca, HistoricoPresenca } from './presenca.schemas.ts'
import type { HistoricoItem, PresencaDaAlocacao } from './presenca.tipos.ts'

const CAMPOS_REGISTRO = {
  id: registrosPontoTable.id,
  tipo_evento: registrosPontoTable.tipo_evento,
  timestamp_servidor: registrosPontoTable.timestamp_servidor,
  com_localizacao: sql<boolean>`(${registrosPontoTable.latitude} is not null)`,
}

@Injectable()
export class PresencaService {
  constructor(@Inject(DRIZZLE_DB) private readonly db: Database) {}

  async daAlocacao(
    usuarioId: string,
    consulta: ConsultarPresenca,
  ): Promise<PresencaDaAlocacao> {
    const medicoId = await this.perfilMedicoId(usuarioId)

    const [alocacao] = await this.db
      .select({
        id: alocacoesTable.id,
        confirmado_at: alocacoesTable.confirmado_at,
        plantao: {
          id: plantoesTable.id,
          titulo: plantoesTable.titulo,
          data_inicio: plantoesTable.data_inicio,
          data_fim: plantoesTable.data_fim,
          local_unidade: plantoesTable.local_unidade,
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
          eq(alocacoesTable.id, consulta.alocacao_id),
          eq(alocacoesTable.medico_id, medicoId),
          isNull(alocacoesTable.deleted_at),
        ),
      )
      .limit(1)

    if (!alocacao) {
      throw new NotFoundException('Alocação não encontrada')
    }

    const registros = await this.db
      .select(CAMPOS_REGISTRO)
      .from(registrosPontoTable)
      .where(eq(registrosPontoTable.alocacao_id, consulta.alocacao_id))
      .orderBy(desc(registrosPontoTable.timestamp_servidor))

    return { alocacao, registros }
  }

  async historico(
    usuarioId: string,
    paginacao: HistoricoPresenca,
  ): Promise<HistoricoItem[]> {
    const medicoId = await this.perfilMedicoId(usuarioId)

    return this.db
      .select({
        ...CAMPOS_REGISTRO,
        alocacao_id: registrosPontoTable.alocacao_id,
        plantao: {
          id: plantoesTable.id,
          titulo: plantoesTable.titulo,
          data_inicio: plantoesTable.data_inicio,
          data_fim: plantoesTable.data_fim,
        },
        instituicao: {
          nome: instituicoesTable.nome,
          cidade: instituicoesTable.cidade,
          uf: instituicoesTable.uf,
        },
      })
      .from(registrosPontoTable)
      .innerJoin(
        alocacoesTable,
        eq(registrosPontoTable.alocacao_id, alocacoesTable.id),
      )
      .innerJoin(plantoesTable, eq(alocacoesTable.plantao_id, plantoesTable.id))
      .innerJoin(
        instituicoesTable,
        eq(plantoesTable.instituicao_id, instituicoesTable.id),
      )
      .where(
        and(
          eq(alocacoesTable.medico_id, medicoId),
          isNull(alocacoesTable.deleted_at),
        ),
      )
      .orderBy(desc(registrosPontoTable.timestamp_servidor))
      .limit(paginacao.limit)
      .offset(paginacao.offset)
  }

  private async perfilMedicoId(usuarioId: string) {
    const [medico] = await this.db
      .select({ id: medicosTable.id })
      .from(medicosTable)
      .where(
        and(
          eq(medicosTable.usuario_id, usuarioId),
          isNull(medicosTable.deleted_at),
        ),
      )
      .limit(1)
    if (!medico) {
      throw new NotFoundException('Perfil médico não encontrado')
    }
    return medico.id
  }
}
