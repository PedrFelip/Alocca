import { Inject, Injectable, NotFoundException } from '@nestjs/common'
import { and, desc, eq, isNull, sql } from 'drizzle-orm'
import { DRIZZLE_DB, type Database } from '../db/db.provider.ts'
import {
  notificacoesTable,
  plantoesTable,
  instituicoesTable,
  preferenciasNotificacaoTable,
} from '../db/schemas/index.ts'

@Injectable()
export class NotificacoesService {
  constructor(@Inject(DRIZZLE_DB) private readonly db: Database) {}

  async detalhePlantao(usuarioId: string, plantaoId: string) {
    const [plantao] = await this.db
      .select({
        id: plantoesTable.id,
        titulo: plantoesTable.titulo,
        instituicao: instituicoesTable.nome,
        local: plantoesTable.local_unidade,
        especialidade: plantoesTable.especialidade,
        inicio: plantoesTable.data_inicio,
        fim: plantoesTable.data_fim,
        valor: plantoesTable.valor,
        status: plantoesTable.status,
      })
      .from(plantoesTable)
      .innerJoin(
        instituicoesTable,
        eq(instituicoesTable.id, plantoesTable.instituicao_id),
      )
      .where(
        and(
          eq(plantoesTable.id, plantaoId),
          sql`EXISTS (
        SELECT 1 FROM notificacoes n WHERE n.plantao_id = ${plantoesTable.id} AND n.usuario_destino_id = ${usuarioId})`,
        ),
      )
      .limit(1)
    if (!plantao) throw new NotFoundException('Plantão não encontrado')
    return plantao
  }

  async listar(
    usuarioId: string,
    limite = 20,
    cursor?: string,
    somenteNaoLidas = false,
  ) {
    const items = await this.db
      .select({
        id: notificacoesTable.id,
        tipo: notificacoesTable.tipo,
        plantao_id: notificacoesTable.plantao_id,
        created_at: notificacoesTable.created_at,
        lida_at: notificacoesTable.lida_at,
      })
      .from(notificacoesTable)
      .where(
        and(
          eq(notificacoesTable.usuario_destino_id, usuarioId),
          somenteNaoLidas ? isNull(notificacoesTable.lida_at) : undefined,
          cursor
            ? sql`(${notificacoesTable.created_at}, ${notificacoesTable.id}) < (
          SELECT n.created_at, n.id FROM notificacoes n
          WHERE n.id = ${cursor} AND n.usuario_destino_id = ${usuarioId}
        )`
            : undefined,
        ),
      )
      .orderBy(desc(notificacoesTable.created_at), desc(notificacoesTable.id))
      .limit(limite + 1)
    const [contagem] = await this.db
      .select({ total: sql<number>`count(*)::int` })
      .from(notificacoesTable)
      .where(
        and(
          eq(notificacoesTable.usuario_destino_id, usuarioId),
          isNull(notificacoesTable.lida_at),
        ),
      )
    const temMais = items.length > limite
    const pagina = items.slice(0, limite)
    return {
      items: pagina,
      next_cursor: temMais ? pagina[pagina.length - 1].id : null,
      nao_lidas: contagem.total,
    }
  }

  async ler(usuarioId: string, id: string) {
    const [item] = await this.db
      .update(notificacoesTable)
      .set({ lida_at: sql`coalesce(${notificacoesTable.lida_at}, now())` })
      .where(
        and(
          eq(notificacoesTable.id, id),
          eq(notificacoesTable.usuario_destino_id, usuarioId),
        ),
      )
      .returning({
        id: notificacoesTable.id,
        lida_at: notificacoesTable.lida_at,
      })
    if (!item) throw new NotFoundException('Notificação não encontrada')
    return item
  }

  async preferencias(usuarioId: string) {
    const [item] = await this.db
      .select({
        push: preferenciasNotificacaoTable.push,
        email: preferenciasNotificacaoTable.email,
      })
      .from(preferenciasNotificacaoTable)
      .where(eq(preferenciasNotificacaoTable.usuario_id, usuarioId))
    return item ?? { push: false, email: false }
  }

  async atualizarPreferencias(
    usuarioId: string,
    data: { push: boolean; email: boolean },
  ) {
    const [item] = await this.db
      .insert(preferenciasNotificacaoTable)
      .values({ usuario_id: usuarioId, ...data })
      .onConflictDoUpdate({
        target: preferenciasNotificacaoTable.usuario_id,
        set: data,
      })
      .returning({
        push: preferenciasNotificacaoTable.push,
        email: preferenciasNotificacaoTable.email,
      })
    return item
  }
}
