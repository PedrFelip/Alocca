import { Inject, Injectable, NotFoundException } from '@nestjs/common'
import { and, count, desc, eq, lte, sql } from 'drizzle-orm'
import { DRIZZLE_DB, type Database } from '../db/db.provider.ts'
import { notificacoesTable, usuariosTable } from '../db/schemas/index.ts'

const textos: Record<string, [string, string]> = {
  ALOCACAO_APROVADA: [
    'Candidatura aprovada',
    'Sua candidatura ao plantão foi aprovada.',
  ],
  CANDIDATURA_REJEITADA: [
    'Candidatura rejeitada',
    'Sua candidatura ao plantão foi rejeitada.',
  ],
  PLANTAO_CANCELADO: ['Plantão cancelado', 'O plantão foi cancelado.'],
  PLANTAO_CONCLUIDO: ['Plantão concluído', 'O plantão foi concluído.'],
}
export function apresentar(n: typeof notificacoesTable.$inferSelect) {
  const [titulo, mensagem] = textos[n.tipo] ?? [
    'Atualização de plantão',
    'Há uma atualização sobre seu plantão.',
  ]
  return {
    id: n.id,
    tipo: n.tipo,
    plantao_id: n.plantao_id,
    titulo,
    mensagem,
    lida_em: n.lida_em?.toISOString() ?? null,
    created_at: n.created_at.toISOString(),
  }
}
@Injectable()
export class NotificacoesService {
  constructor(@Inject(DRIZZLE_DB) private readonly db: Database) {}
  async listar(usuario: string, pagina: number, limite: number, ate?: string) {
    const snapshot = ate ?? new Date().toISOString()
    const filtro = and(
      eq(notificacoesTable.usuario_destino_id, usuario),
      lte(notificacoesTable.created_at, new Date(snapshot)),
    )
    const [dados, [{ total }]] = await Promise.all([
      this.db
        .select()
        .from(notificacoesTable)
        .where(filtro)
        .orderBy(desc(notificacoesTable.created_at), desc(notificacoesTable.id))
        .limit(limite)
        .offset((pagina - 1) * limite),
      this.db.select({ total: count() }).from(notificacoesTable).where(filtro),
    ])
    return {
      dados: dados.map(apresentar),
      pagina,
      limite,
      total,
      ate: snapshot,
    }
  }
  async ler(usuario: string, id: string) {
    const [n] = await this.db
      .update(notificacoesTable)
      .set({ lida_em: sql`coalesce(${notificacoesTable.lida_em}, now())` })
      .where(
        and(
          eq(notificacoesTable.id, id),
          eq(notificacoesTable.usuario_destino_id, usuario),
        ),
      )
      .returning()
    if (!n) throw new NotFoundException('Notificação não encontrada')
    return apresentar(n)
  }
  async preferencias(usuario: string) {
    const [u] = await this.db
      .select({ email_habilitado: usuariosTable.email_notificacoes_habilitado })
      .from(usuariosTable)
      .where(eq(usuariosTable.id, usuario))
    return u
  }
  async atualizarPreferencias(usuario: string, habilitado: boolean) {
    const [u] = await this.db
      .update(usuariosTable)
      .set({ email_notificacoes_habilitado: habilitado })
      .where(eq(usuariosTable.id, usuario))
      .returning({
        email_habilitado: usuariosTable.email_notificacoes_habilitado,
      })
    return u
  }
}
