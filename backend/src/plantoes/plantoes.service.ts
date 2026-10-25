import { Inject, Injectable, NotFoundException } from '@nestjs/common'
import {
  and,
  asc,
  eq,
  gt,
  gte,
  ilike,
  isNull,
  lte,
  notExists,
  sql,
} from 'drizzle-orm'
import { DRIZZLE_DB, type Database } from '../db/db.provider.ts'
import {
  candidaturasTable,
  instituicoesTable,
  medicosTable,
  plantoesTable,
} from '../db/schemas/index.ts'
import type { ListarPlantoes } from './plantoes.schemas.ts'

function trecho(value: string): string {
  return `%${value.replace(/[\\%_]/g, '\\$&')}%`
}

@Injectable()
export class PlantoesService {
  constructor(@Inject(DRIZZLE_DB) private readonly db: Database) {}

  async listar(usuarioId: string, filtros: ListarPlantoes) {
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
    if (!medico) throw new NotFoundException('Perfil médico não encontrado')

    const condicoes = [
      eq(plantoesTable.status, 'ABERTO'),
      eq(plantoesTable.permite_candidatura, true),
      eq(instituicoesTable.ativa, true),
      gt(plantoesTable.vagas_disponiveis, 0),
      gte(plantoesTable.data_fim, sql`now()`),
      isNull(plantoesTable.deleted_at),
      isNull(instituicoesTable.deleted_at),
      // Não lista plantões em que o próprio médico já se candidatou.
      notExists(
        this.db
          .select({ um: sql`1` })
          .from(candidaturasTable)
          .where(
            and(
              eq(candidaturasTable.plantao_id, plantoesTable.id),
              eq(candidaturasTable.medico_id, medico.id),
            ),
          ),
      ),
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
        local_unidade: plantoesTable.local_unidade,
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
      .orderBy(asc(plantoesTable.data_inicio), asc(plantoesTable.id))
      .limit(filtros.limit)
      .offset(filtros.offset)
  }
}
