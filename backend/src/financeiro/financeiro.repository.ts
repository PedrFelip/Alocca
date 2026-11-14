import { Inject, Injectable, NotFoundException } from '@nestjs/common'
import { alias } from 'drizzle-orm/pg-core'
import { and, desc, eq, isNull, lte, ne, sql } from 'drizzle-orm'
import { DRIZZLE_DB, type Database } from '../db/db.provider.ts'
import {
  gestoresInstituicoesTable,
  gestoresTable,
  usuariosTable,
  alocacoesTable,
  instituicoesTable,
  medicosTable,
  pagamentosTable,
  plantoesTable,
} from '../db/schemas/index.ts'
import type { DashboardFinanceiro } from './financeiro.tipos.ts'

const usuarioGestor = alias(usuariosTable, 'usuario_gestor_financeiro')

export type FinanceiroExecutor = Pick<Database, 'select' | 'update' | 'execute'>
const CAMPOS_PAGAMENTO = {
  id: pagamentosTable.id,
  valor: pagamentosTable.valor,
  status: pagamentosTable.status,
  vencimento_em: pagamentosTable.vencimento_em,
  pago_at: pagamentosTable.pago_at,
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
}

function visaoDoMedico(medicoId: string) {
  return and(
    eq(alocacoesTable.medico_id, medicoId),
    isNull(alocacoesTable.deleted_at),
    isNull(pagamentosTable.deleted_at),
    isNull(instituicoesTable.deleted_at),
    // plantao excluido ou cancelado nao entra no financeiro
    isNull(plantoesTable.deleted_at),
    ne(plantoesTable.status, 'CANCELADO'),
  )
}

@Injectable()
export class FinanceiroRepository {
  constructor(@Inject(DRIZZLE_DB) private readonly db: Database) {}
  private consultaGestor(db: FinanceiroExecutor, gestorId: string) {
    return db
      .select({
        ...CAMPOS_PAGAMENTO,
        elegivel: sql<boolean>`${plantoesTable.data_fim} <= clock_timestamp()`,
        gestor_id: gestoresInstituicoesTable.gestor_id,
        medico: { nome: usuariosTable.nome },
      })
      .from(pagamentosTable)
      .innerJoin(
        alocacoesTable,
        eq(pagamentosTable.alocacao_id, alocacoesTable.id),
      )
      .innerJoin(plantoesTable, eq(alocacoesTable.plantao_id, plantoesTable.id))
      .innerJoin(
        instituicoesTable,
        eq(plantoesTable.instituicao_id, instituicoesTable.id),
      )
      .innerJoin(
        gestoresInstituicoesTable,
        and(
          eq(gestoresInstituicoesTable.instituicao_id, instituicoesTable.id),
          eq(gestoresInstituicoesTable.gestor_id, gestorId),
        ),
      )
      .innerJoin(
        gestoresTable,
        eq(gestoresInstituicoesTable.gestor_id, gestoresTable.id),
      )
      .innerJoin(usuarioGestor, eq(gestoresTable.usuario_id, usuarioGestor.id))
      .innerJoin(medicosTable, eq(alocacoesTable.medico_id, medicosTable.id))
      .innerJoin(usuariosTable, eq(medicosTable.usuario_id, usuariosTable.id))
  }

  private visaoGestor() {
    return and(
      eq(gestoresTable.ativa, true),
      isNull(gestoresTable.deleted_at),
      eq(usuarioGestor.status, 'ATIVO'),
      eq(usuarioGestor.tipo, 'GESTOR'),
      isNull(usuarioGestor.deleted_at),
      isNull(pagamentosTable.deleted_at),
      isNull(alocacoesTable.deleted_at),
      isNull(plantoesTable.deleted_at),
      ne(plantoesTable.status, 'CANCELADO'),
      isNull(instituicoesTable.deleted_at),
      isNull(medicosTable.deleted_at),
    )
  }

  async pendentes(gestorId: string) {
    const linhas = await this.consultaGestor(this.db, gestorId)
      .where(
        and(
          this.visaoGestor(),
          eq(pagamentosTable.status, 'PENDENTE'),
          lte(plantoesTable.data_fim, sql`now()`),
        ),
      )
      .orderBy(desc(plantoesTable.data_fim))
    return linhas.map(
      ({ gestor_id: _gestor, elegivel: _elegivel, ...pagamento }) => pagamento,
    )
  }

  async bloquearPagamento(
    tx: FinanceiroExecutor,
    gestorId: string,
    id: string,
  ) {
    // Exclusivo apenas no pagamento. Baixas diferentes podem compartilhar
    // gestor/instituição sem serializar seus uploads.
    const [reserva] = await this.consultaGestor(tx, gestorId)
      .where(and(this.visaoGestor(), eq(pagamentosTable.id, id)))
      .for('update', { of: pagamentosTable })
    if (!reserva) return undefined
    const [pagamento] = await this.consultaGestor(tx, gestorId)
      .where(and(this.visaoGestor(), eq(pagamentosTable.id, id)))
      .for('share', {
        of: [
          gestoresInstituicoesTable,
          gestoresTable,
          usuarioGestor,
          plantoesTable,
          instituicoesTable,
          alocacoesTable,
          medicosTable,
          usuariosTable,
        ],
      })
    return pagamento
  }

  async revalidarPagamento(
    tx: FinanceiroExecutor,
    gestorId: string,
    id: string,
  ) {
    // Os locks de bloquearPagamento permanecem até o commit.
    const [pagamento] = await this.consultaGestor(tx, gestorId).where(
      and(this.visaoGestor(), eq(pagamentosTable.id, id)),
    )
    return pagamento
  }

  async registrarBaixa(
    tx: FinanceiroExecutor,
    id: string,
    gestorId: string,
    chave: string,
    mime: string,
  ) {
    await tx
      .update(pagamentosTable)
      .set({
        status: 'PAGO',
        pago_at: sql`clock_timestamp()`,
        registrado_por_gestor_id: gestorId,
        comprovante_chave: chave,
        comprovante_mime: mime,
      })
      .where(
        and(eq(pagamentosTable.id, id), eq(pagamentosTable.status, 'PENDENTE')),
      )
  }

  async referenciaBloqueada(tx: FinanceiroExecutor, id: string) {
    await tx.execute(sql`set local lock_timeout = '5s'`)
    const [pagamento] = await tx
      .select({ chave: pagamentosTable.comprovante_chave })
      .from(pagamentosTable)
      .where(eq(pagamentosTable.id, id))
      .for('update')
    return pagamento
  }

  async comprovante(usuarioId: string, id: string) {
    const medicoId = await this.perfilMedicoId(usuarioId)
    const [pagamento] = await this.db
      .select({
        chave: pagamentosTable.comprovante_chave,
        mime: pagamentosTable.comprovante_mime,
      })
      .from(pagamentosTable)
      .innerJoin(
        alocacoesTable,
        eq(pagamentosTable.alocacao_id, alocacoesTable.id),
      )
      .innerJoin(plantoesTable, eq(alocacoesTable.plantao_id, plantoesTable.id))
      .innerJoin(
        instituicoesTable,
        eq(plantoesTable.instituicao_id, instituicoesTable.id),
      )
      .where(
        and(
          visaoDoMedico(medicoId),
          eq(pagamentosTable.id, id),
          eq(pagamentosTable.status, 'PAGO'),
        ),
      )
    return pagamento
  }
  async doMedico(usuarioId: string): Promise<DashboardFinanceiro> {
    const medicoId = await this.perfilMedicoId(usuarioId)
    const visao = visaoDoMedico(medicoId)

    // REPEATABLE READ compartilha um único snapshot entre resumo e lista; em
    // READ COMMITTED uma baixa concorrente poderia aparecer só em um deles.
    return this.db.transaction(
      async (tx) => {
        const linhasResumo = await tx
          .select({
            total_recebido: sql<string>`coalesce(sum(case when ${pagamentosTable.status} = 'PAGO' then ${pagamentosTable.valor} else 0 end), 0)::text`,
            total_a_receber: sql<string>`coalesce(sum(case when ${pagamentosTable.status} = 'PENDENTE' and (${pagamentosTable.vencimento_em} is null or ${pagamentosTable.vencimento_em} >= now()) then ${pagamentosTable.valor} else 0 end), 0)::text`,
            total_pendente: sql<string>`coalesce(sum(case when ${pagamentosTable.status} = 'PENDENTE' and ${pagamentosTable.vencimento_em} < now() then ${pagamentosTable.valor} else 0 end), 0)::text`,
          })
          .from(pagamentosTable)
          .innerJoin(
            alocacoesTable,
            eq(pagamentosTable.alocacao_id, alocacoesTable.id),
          )
          .innerJoin(
            plantoesTable,
            eq(alocacoesTable.plantao_id, plantoesTable.id),
          )
          .innerJoin(
            instituicoesTable,
            eq(plantoesTable.instituicao_id, instituicoesTable.id),
          )
          .where(visao)
        const pagamentos = await tx
          .select(CAMPOS_PAGAMENTO)
          .from(pagamentosTable)
          .innerJoin(
            alocacoesTable,
            eq(pagamentosTable.alocacao_id, alocacoesTable.id),
          )
          .innerJoin(
            plantoesTable,
            eq(alocacoesTable.plantao_id, plantoesTable.id),
          )
          .innerJoin(
            instituicoesTable,
            eq(plantoesTable.instituicao_id, instituicoesTable.id),
          )
          .where(visao)
          .orderBy(desc(plantoesTable.data_inicio))

        return { resumo: linhasResumo[0]!, pagamentos }
      },
      { isolationLevel: 'repeatable read', accessMode: 'read only' },
    )
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
