import { Inject, Injectable } from '@nestjs/common'
import { and, asc, desc, eq, isNull, sql } from 'drizzle-orm'
import { DRIZZLE_DB, type Database } from '../db/db.provider.ts'
import {
  alocacoesTable as alocacoes,
  gestoresInstituicoesTable as vinculos,
  instituicoesTable as instituicoes,
  medicosTable as medicos,
  pagamentosTable as pagamentos,
  plantoesTable as plantoes,
  registrosPontoTable as pontos,
  usuariosTable as usuarios,
} from '../db/schemas/index.ts'

@Injectable()
export class ConsultasGestorRepository {
  constructor(@Inject(DRIZZLE_DB) private readonly db: Database) {}

  async indicadores(gestorId: string) {
    const [resultado] = await this.db.select({
      atualizado_em: sql<string>`atualizado_em`,
      plantoes: sql<number>`plantoes`,
      medicos_vinculados: sql<number>`medicos_vinculados`,
      vagas_preenchidas: sql<number>`vagas_preenchidas`,
      total_pago: sql<string>`total_pago`,
      total_a_pagar: sql<string>`total_a_pagar`,
      total_em_atraso: sql<string>`total_em_atraso`,
    }).from(sql`(
      with plantoes_elegiveis as (
        select p.id
        from ${plantoes} p
        join ${instituicoes} i on i.id = p.instituicao_id
        where i.ativa = true and i.deleted_at is null
          and p.deleted_at is null and p.status <> 'CANCELADO'
          and exists (
            select 1 from ${vinculos} v
            where v.instituicao_id = i.id and v.gestor_id = ${gestorId}
          )
      ), alocacoes_elegiveis as (
        select a.id, a.medico_id
        from ${alocacoes} a
        join plantoes_elegiveis p on p.id = a.plantao_id
        join ${medicos} m on m.id = a.medico_id
        join ${usuarios} u on u.id = m.usuario_id
        where a.deleted_at is null and m.deleted_at is null and u.deleted_at is null
      ), resumo_pagamentos as (
        select
          coalesce(sum(pg.valor) filter (where pg.status = 'PAGO'), 0)::text as total_pago,
          coalesce(sum(pg.valor) filter (where pg.status = 'PENDENTE' and
            (pg.vencimento_em is null or pg.vencimento_em >= now())), 0)::text as total_a_pagar,
          coalesce(sum(pg.valor) filter (where pg.status = 'PENDENTE' and
            pg.vencimento_em < now()), 0)::text as total_em_atraso
        from ${pagamentos} pg
        join alocacoes_elegiveis a on a.id = pg.alocacao_id
        where pg.deleted_at is null
      )
      select to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as atualizado_em,
        (select count(*)::integer from plantoes_elegiveis) as plantoes,
        (select count(distinct medico_id)::integer from alocacoes_elegiveis) as medicos_vinculados,
        (select count(*)::integer from alocacoes_elegiveis) as vagas_preenchidas,
        total_pago, total_a_pagar, total_em_atraso
      from resumo_pagamentos
    ) as indicadores`)
    const { total_pago, total_a_pagar, total_em_atraso, ...contagens } =
      resultado!
    return {
      periodo: 'todo_historico' as const,
      ...contagens,
      pagamentos: { total_pago, total_a_pagar, total_em_atraso },
    }
  }

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
