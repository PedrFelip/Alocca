import { Inject, Injectable } from '@nestjs/common'
import { and, eq, isNull, sql } from 'drizzle-orm'
import { DRIZZLE_DB, type Database } from '../db/db.provider.ts'
import {
  gestoresInstituicoesTable,
  instituicoesTable,
} from '../db/schemas/index.ts'
import type { Detalhes } from './instituicoes.schemas.ts'

const detalhesInstituicao = {
  id: instituicoesTable.id,
  nome: instituicoesTable.nome,
  nome_fantasia: instituicoesTable.nome_fantasia,
  cnpj: instituicoesTable.cnpj,
  cidade: instituicoesTable.cidade,
  uf: instituicoesTable.uf,
  bairro: instituicoesTable.bairro,
  logradouro: instituicoesTable.logradouro,
}

@Injectable()
export class InstituicoesRepository {
  constructor(@Inject(DRIZZLE_DB) private readonly db: Database) {}

  private consulta(gestorId: string) {
    const condicoes = and(
      eq(gestoresInstituicoesTable.gestor_id, gestorId),
      eq(instituicoesTable.ativa, true),
      isNull(instituicoesTable.deleted_at),
    )
    const join = eq(
      gestoresInstituicoesTable.instituicao_id,
      instituicoesTable.id,
    )
    const revisao = sql<
      string | null
    >`md5(string_agg(${instituicoesTable.id}::text || ':' || ${instituicoesTable.cache_revisao}::text, ',' order by ${instituicoesTable.id}))`
    return { condicoes, join, revisao }
  }

  async revisao(gestorId: string) {
    const { condicoes, join, revisao } = this.consulta(gestorId)
    const [estado] = await this.db
      .select({ revisao })
      .from(gestoresInstituicoesTable)
      .innerJoin(instituicoesTable, join)
      .where(condicoes)
    return estado?.revisao ?? null
  }

  async snapshot(gestorId: string) {
    const { condicoes, join, revisao } = this.consulta(gestorId)
    const [atual] = await this.db
      .select({
        revisao,
        dados: sql<Detalhes[]>`coalesce(jsonb_agg(jsonb_build_object(${sql.join(
          Object.entries(detalhesInstituicao).flatMap(([name, column]) => [
            sql`${name}::text`,
            sql`${column}`,
          ]),
          sql`, `,
        )}) order by ${instituicoesTable.nome}, ${instituicoesTable.id}), '[]'::jsonb)`,
      })
      .from(gestoresInstituicoesTable)
      .innerJoin(instituicoesTable, join)
      .where(condicoes)
    return atual ?? { revisao: null, dados: [] }
  }
}
