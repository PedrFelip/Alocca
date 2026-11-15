import { alias } from 'drizzle-orm/pg-core'
import { Inject, Injectable } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import type { Env } from '../config/env.ts'
import { and, eq, gt, isNull, sql, inArray, ne, lt } from 'drizzle-orm'
import { type Database } from '../db/db.provider.ts'
import {
  alocacoesTable,
  candidaturasTable,
  notificacoesTable,
  instituicoesTable,
  medicosTable,
  pagamentosTable,
  plantoesTable,
  usuariosTable,
} from '../db/schemas/index.ts'

export type TransacaoAlocacao = Parameters<
  Parameters<Database['transaction']>[0]
>[0]

@Injectable()
export class AlocacaoRepository {
  constructor(
    @Inject(ConfigService) private readonly config: ConfigService<Env, true>,
  ) {}
  candidatura(tx: TransacaoAlocacao, id: string) {
    return tx
      .select({
        id: candidaturasTable.id,
        medico_id: candidaturasTable.medico_id,
        plantao_id: candidaturasTable.plantao_id,
      })
      .from(candidaturasTable)
      .where(
        and(eq(candidaturasTable.id, id), isNull(candidaturasTable.deleted_at)),
      )
      .limit(1)
  }

  bloquearMedico(tx: TransacaoAlocacao, id: string) {
    return tx
      .select({
        id: medicosTable.id,
        status_validacao: medicosTable.status_validacao,
      })
      .from(medicosTable)
      .where(and(eq(medicosTable.id, id), isNull(medicosTable.deleted_at)))
      .for('update')
      .limit(1)
  }

  bloquearPlantao(tx: TransacaoAlocacao, id: string) {
    return tx
      .select({
        id: plantoesTable.id,
        status: plantoesTable.status,
        vagas_disponiveis: plantoesTable.vagas_disponiveis,
        data_inicio: plantoesTable.data_inicio,
        data_fim: plantoesTable.data_fim,
        valor: plantoesTable.valor,
        instituicao_id: plantoesTable.instituicao_id,
      })
      .from(plantoesTable)
      .where(and(eq(plantoesTable.id, id), isNull(plantoesTable.deleted_at)))
      .for('update')
      .limit(1)
  }

  instituicaoAtiva(tx: TransacaoAlocacao, id: string) {
    return tx
      .select({ id: instituicoesTable.id })
      .from(instituicoesTable)
      .where(
        and(
          eq(instituicoesTable.id, id),
          eq(instituicoesTable.ativa, true),
          isNull(instituicoesTable.deleted_at),
        ),
      )
      .limit(1)
  }

  contaMedico(tx: TransacaoAlocacao, medicoId: string) {
    return tx
      .select({ status: usuariosTable.status })
      .from(medicosTable)
      .innerJoin(usuariosTable, eq(medicosTable.usuario_id, usuariosTable.id))
      .where(eq(medicosTable.id, medicoId))
      .limit(1)
  }

  bloquearCandidatura(tx: TransacaoAlocacao, id: string) {
    return tx
      .select({
        id: candidaturasTable.id,
        medico_id: candidaturasTable.medico_id,
        status: candidaturasTable.status,
      })
      .from(candidaturasTable)
      .where(eq(candidaturasTable.id, id))
      .for('update')
      .limit(1)
  }

  criarAlocacao(
    tx: TransacaoAlocacao,
    plantaoId: string,
    medicoId: string,
    candidaturaId: string,
  ) {
    return tx
      .insert(alocacoesTable)
      .values({
        plantao_id: plantaoId,
        medico_id: medicoId,
        candidatura_id: candidaturaId,
      })
      .returning()
  }

  aprovar(tx: TransacaoAlocacao, candidaturaId: string, gestorId: string) {
    return tx
      .update(candidaturasTable)
      .set({
        status: 'APROVADA',
        analisado_por_gestor_id: gestorId,
        analisado_at: new Date(),
      })
      .where(eq(candidaturasTable.id, candidaturaId))
  }

  criarPagamento(
    tx: TransacaoAlocacao,
    alocacaoId: string,
    valor: string,
    gestorId: string,
  ) {
    return tx.insert(pagamentosTable).values({
      alocacao_id: alocacaoId,
      valor,
      status: 'PENDENTE',
      registrado_por_gestor_id: gestorId,
    })
  }

  decrementarVaga(tx: TransacaoAlocacao, plantaoId: string) {
    return tx
      .update(plantoesTable)
      .set({ vagas_disponiveis: sql`${plantoesTable.vagas_disponiveis} - 1` })
      .where(
        and(
          eq(plantoesTable.id, plantaoId),
          gt(plantoesTable.vagas_disponiveis, 0),
        ),
      )
      .returning({
        status: plantoesTable.status,
        quantidade_vagas: plantoesTable.quantidade_vagas,
        vagas_disponiveis: plantoesTable.vagas_disponiveis,
      })
  }
  async usuariosPorMedicoId(
    tx: Parameters<Parameters<Database['transaction']>[0]>[0],
    medicoIds: string[],
  ) {
    if (medicoIds.length === 0) return []
    return tx
      .select({
        medico_id: medicosTable.id,
        usuario_id: usuariosTable.id,
      })
      .from(medicosTable)
      .innerJoin(usuariosTable, eq(medicosTable.usuario_id, usuariosTable.id))
      .where(inArray(medicosTable.id, medicoIds))
  }
  sobrepoeAlocacao(
    plantaoId: string,
    medicoId: string,
    plantao: { data_inicio: Date; data_fim: Date },
    banco: TransacaoAlocacao,
  ) {
    const plantaoConflito = alias(plantoesTable, 'plantao_conflito')
    return banco
      .select({ plantao_id: plantaoConflito.id })
      .from(alocacoesTable)
      .innerJoin(
        plantaoConflito,
        eq(alocacoesTable.plantao_id, plantaoConflito.id),
      )
      .where(
        and(
          eq(alocacoesTable.medico_id, medicoId),
          ne(alocacoesTable.plantao_id, plantaoId),
          isNull(alocacoesTable.deleted_at),
          isNull(plantaoConflito.deleted_at),
          // plantao cancelado nao ocupa mais a agenda
          ne(plantaoConflito.status, 'CANCELADO'),
          // Intervalos semi-abertos: toca nas bordas não é sobreposição.
          lt(plantaoConflito.data_inicio, plantao.data_fim),
          gt(plantaoConflito.data_fim, plantao.data_inicio),
        ),
      )
      .limit(1)
  }
  preencherPlantao(tx: TransacaoAlocacao, plantaoId: string) {
    return tx
      .update(plantoesTable)
      .set({ status: 'PREENCHIDO' })
      .where(eq(plantoesTable.id, plantaoId))
  }

  rejeitarRestantes(
    tx: TransacaoAlocacao,
    plantaoId: string,
    candidaturaId: string,
    gestorId: string,
  ) {
    return tx
      .update(candidaturasTable)
      .set({
        status: 'REJEITADA',
        analisado_por_gestor_id: gestorId,
        analisado_at: new Date(),
      })
      .where(
        and(
          eq(candidaturasTable.plantao_id, plantaoId),
          ne(candidaturasTable.id, candidaturaId),
          eq(candidaturasTable.status, 'PENDENTE'),
          isNull(candidaturasTable.deleted_at),
        ),
      )
      .returning({ medico_id: candidaturasTable.medico_id })
  }
  notificar(
    tx: TransacaoAlocacao,
    eventos: { usuario_destino_id: string; plantao_id: string; tipo: string }[],
  ) {
    if (eventos.length === 0) return Promise.resolve([])
    return tx
      .insert(notificacoesTable)
      .values(
        eventos.map((evento) => ({
          ...evento,
          email_elegivel:
            this.config.get('NOTIFICACOES_EMAIL_HABILITADO', {
              infer: true,
            }) === 'true'
              ? sql<boolean>`coalesce((select email_notificacoes_habilitado from usuarios where id = ${evento.usuario_destino_id}), false)`
              : false,
        })),
      )
      .returning({ id: notificacoesTable.id })
  }
}
