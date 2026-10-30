import { Inject, Injectable, NotFoundException } from '@nestjs/common'
import { and, eq, gte, isNull, lt, sql } from 'drizzle-orm'
import { DRIZZLE_DB, type Database } from '../db/db.provider.ts'
import {
  alocacoesTable,
  candidaturasTable,
  instituicoesTable,
  medicosTable,
  plantoesTable,
} from '../db/schemas/index.ts'
import type { AgendaDia, AgendaPeriodo } from './agenda.tipos.ts'

const FUSO_APRESENTACAO = 'America/Sao_Paulo'
const FUSO_OFFSET = '-03:00'
const FORMATO_DATA = new Intl.DateTimeFormat('en-CA', {
  timeZone: FUSO_APRESENTACAO,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})

const CAMPOS_PLANTAO = {
  id: plantoesTable.id,
  titulo: plantoesTable.titulo,
  especialidade: plantoesTable.especialidade,
  data_inicio: plantoesTable.data_inicio,
  data_fim: plantoesTable.data_fim,
  valor: plantoesTable.valor,
  local_unidade: plantoesTable.local_unidade,
}

const CAMPOS_INSTITUICAO = {
  id: instituicoesTable.id,
  nome: instituicoesTable.nome,
  cidade: instituicoesTable.cidade,
  uf: instituicoesTable.uf,
}

type RegistroDoBanco = {
  id: string
  tipo_origem: 'CANDIDATURA' | 'ALOCACAO'
  plantao: {
    id: string
    titulo: string
    especialidade: string
    data_inicio: Date
    data_fim: Date
    valor: string
    local_unidade: string
  }
  instituicao: { id: string; nome: string; cidade: string | null; uf: string | null }
}

type RegistroBruto = Omit<RegistroDoBanco, 'tipo_origem'> & {
  tipo_origem: string
}

@Injectable()
export class AgendaService {
  constructor(@Inject(DRIZZLE_DB) private readonly db: Database) {}

  async doMes(usuarioId: string, periodo: AgendaPeriodo): Promise<AgendaDia[]> {
    const medicoId = await this.perfilMedicoId(usuarioId)

    const inicio = new Date(
      `${periodo.ano}-${String(periodo.mes).padStart(2, '0')}-01T00:00:00${FUSO_OFFSET}`,
    )
    const fim = new Date(inicio)
    fim.setUTCMonth(fim.getUTCMonth() + 1)

    const visao = and(
      gte(plantoesTable.data_inicio, inicio),
      lt(plantoesTable.data_inicio, fim),
      isNull(plantoesTable.deleted_at),
      isNull(instituicoesTable.deleted_at),
    )
    const visaoComEstado = and(
      visao,
      sql`(${plantoesTable.status} <> 'CANCELADO')`,
    )
    const juntados = {
      plantao: CAMPOS_PLANTAO,
      instituicao: CAMPOS_INSTITUICAO,
    }

    const [pendentes, alocados] = await Promise.all([
      this.db
        .select({
          id: candidaturasTable.id,
          tipo_origem: sql<string>`'CANDIDATURA'`,
          ...juntados,
        })
        .from(candidaturasTable)
        .innerJoin(
          plantoesTable,
          eq(candidaturasTable.plantao_id, plantoesTable.id),
        )
        .innerJoin(
          instituicoesTable,
          eq(plantoesTable.instituicao_id, instituicoesTable.id),
        )
        .where(
          and(
            eq(candidaturasTable.medico_id, medicoId),
            eq(candidaturasTable.status, 'PENDENTE'),
            visaoComEstado,
          ),
        ),
      this.db
        .select({
          id: alocacoesTable.id,
          tipo_origem: sql<string>`'ALOCACAO'`,
          ...juntados,
        })
        .from(alocacoesTable)
        .innerJoin(
          plantoesTable,
          eq(alocacoesTable.plantao_id, plantoesTable.id),
        )
        .innerJoin(
          instituicoesTable,
          eq(plantoesTable.instituicao_id, instituicoesTable.id),
        )
        .where(and(eq(alocacoesTable.medico_id, medicoId), visaoComEstado)),
    ])

    return this.agruparPorDia(pendentes, alocados)
  }

  private agruparPorDia(
    pendentes: ReadonlyArray<RegistroBruto>,
    alocados: ReadonlyArray<RegistroBruto>,
  ): AgendaDia[] {
    const agora = Date.now()
    const itens = [...pendentes, ...alocados]
      .map((registro) => ({
        id: registro.id,
        tipo_origem: registro.tipo_origem as RegistroDoBanco['tipo_origem'],
        status:
          registro.tipo_origem === 'CANDIDATURA'
            ? ('PENDENTE' as const)
            : registro.plantao.data_fim.getTime() < agora
              ? ('CONCLUIDO' as const)
              : ('CONFIRMADO' as const),
        plantao: registro.plantao,
        instituicao: registro.instituicao,
      }))
      .sort((a, b) => a.plantao.data_fim.getTime() - b.plantao.data_fim.getTime())

    const dias = new Map<string, AgendaDia>()
    for (const item of itens) {
      const chave = FORMATO_DATA.format(item.plantao.data_fim)
      const grupo = dias.get(chave) ?? { dia: chave, itens: [] }
      grupo.itens.push(item)
      dias.set(chave, grupo)
    }
    return [...dias.values()]
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
