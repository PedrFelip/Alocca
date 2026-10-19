import { Inject, Injectable } from '@nestjs/common'
import { and, asc, eq, gt, gte, ilike, isNull, lte } from 'drizzle-orm'
import { DRIZZLE_DB, type Database } from '../db/db.provider.js'
import { instituicoesTable, plantoesTable } from '../db/schemas/index.js'
import type { ListarPlantoes } from './plantoes.schemas.js'

function trecho(value: string): string {
  return `%${value.replace(/[\\%_]/g, '\\$&')}%`
}

@Injectable()
export class PlantoesService {
  constructor(@Inject(DRIZZLE_DB) private readonly db: Database) {}

  listar(filtros: ListarPlantoes) {
    const condicoes = [
      eq(plantoesTable.status, 'ABERTO'),
      eq(plantoesTable.permite_candidatura, true),
      gt(plantoesTable.vagas_disponiveis, 0),
      isNull(plantoesTable.deleted_at),
      isNull(instituicoesTable.deleted_at),
    ]
    if (filtros.especialidade) {
      condicoes.push(
        ilike(plantoesTable.especialidade, trecho(filtros.especialidade)),
      )
    }
    if (filtros.cidade) {
      condicoes.push(ilike(instituicoesTable.cidade, trecho(filtros.cidade)))
    }
    if (filtros.uf) {
      condicoes.push(eq(instituicoesTable.uf, filtros.uf))
    }
    if (filtros.valor_min !== undefined) {
      condicoes.push(gte(plantoesTable.valor, String(filtros.valor_min)))
    }
    if (filtros.valor_max !== undefined) {
      condicoes.push(lte(plantoesTable.valor, String(filtros.valor_max)))
    }

    return this.db
      .select({
        id: plantoesTable.id,
        titulo: plantoesTable.titulo,
        descricao: plantoesTable.descricao,
        especialidade: plantoesTable.especialidade,
        data_inicio: plantoesTable.data_inicio,
        data_fim: plantoesTable.data_fim,
        valor: plantoesTable.valor,
        quantidade_vagas: plantoesTable.quantidade_vagas,
        vagas_disponiveis: plantoesTable.vagas_disponiveis,
        exige_checkin: plantoesTable.exige_checkin,
        permite_geolocalizacao: plantoesTable.permite_geolocalizacao,
        instituicao: {
          id: instituicoesTable.id,
          nome: instituicoesTable.nome,
          nome_fantasia: instituicoesTable.nome_fantasia,
          cidade: instituicoesTable.cidade,
          uf: instituicoesTable.uf,
          bairro: instituicoesTable.bairro,
          logradouro: instituicoesTable.logradouro,
        },
      })
      .from(plantoesTable)
      .innerJoin(
        instituicoesTable,
        eq(plantoesTable.instituicao_id, instituicoesTable.id),
      )
      .where(and(...condicoes))
      .orderBy(asc(plantoesTable.data_inicio))
  }
}
