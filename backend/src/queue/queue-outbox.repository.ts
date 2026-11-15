import { Inject, Injectable } from '@nestjs/common'
import { and, eq, gt, isNull, lt, lte, or, sql } from 'drizzle-orm'
import { DRIZZLE_DB, type Database } from '../db/db.provider.ts'
import {
  emailsPendentesTable,
  notificacoesTable,
  usuariosTable,
} from '../db/schemas/index.ts'

@Injectable()
export class QueueOutboxRepository {
  constructor(@Inject(DRIZZLE_DB) private readonly db: Database) {}

  async listarEmails(after?: string) {
    return await this.db
      .select({ id: emailsPendentesTable.id })
      .from(emailsPendentesTable)
      .where(
        and(
          lte(emailsPendentesTable.disponivel_em, sql`now()`),
          after ? gt(emailsPendentesTable.id, after) : undefined,
        ),
      )
      .orderBy(emailsPendentesTable.id)
      .limit(100)
  }

  async listarNotificacoes(after?: string) {
    await this.db
      .update(notificacoesTable)
      .set({ email_elegivel: false, entrega_token: null, entrega_ate: null })
      .where(
        and(
          eq(notificacoesTable.email_elegivel, true),
          eq(notificacoesTable.status, 'PENDENTE'),
          sql`${notificacoesTable.tentativas} >= 5`,
          or(
            isNull(notificacoesTable.entrega_ate),
            lte(notificacoesTable.entrega_ate, sql`now()`),
          ),
        ),
      )
    return await this.db
      .select({ id: notificacoesTable.id })
      .from(notificacoesTable)
      .innerJoin(
        usuariosTable,
        eq(usuariosTable.id, notificacoesTable.usuario_destino_id),
      )
      .where(
        and(
          after ? gt(notificacoesTable.id, after) : undefined,
          eq(notificacoesTable.status, 'PENDENTE'),
          eq(notificacoesTable.email_elegivel, true),
          lt(notificacoesTable.tentativas, 5),
          lte(notificacoesTable.disponivel_em, sql`now()`),
          or(
            isNull(notificacoesTable.entrega_ate),
            lte(notificacoesTable.entrega_ate, sql`now()`),
          ),
          eq(usuariosTable.email_notificacoes_habilitado, true),
          eq(usuariosTable.status, 'ATIVO'),
          isNull(usuariosTable.deleted_at),
        ),
      )
      .orderBy(notificacoesTable.id)
      .limit(100)
  }
}
