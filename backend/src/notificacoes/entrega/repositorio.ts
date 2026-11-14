import { sql, type SQL } from 'drizzle-orm'
import type { Database } from '../../db/db.provider.ts'
import type { Entrega, Mensagem } from './contrato.ts'

// Mesmo SQL em PostgreSQL real e PGlite; nenhuma chamada ao provedor mantém locks SQL.
export class RepositorioEntregas {
  constructor(private readonly db: Database) {}
  private async rows<T>(query: SQL): Promise<T[]> {
    const result = await this.db.execute(query)
    return (
      Array.isArray(result) ? result : (result as unknown as { rows: T[] }).rows
    ) as T[]
  }
  async expandir(limite: number): Promise<number> {
    return this.db.transaction(async (tx) => {
      const repo = new RepositorioEntregas(tx as unknown as Database)
      const eventos = await repo.rows<{ id: string }>(sql`
        SELECT id FROM notificacoes WHERE processada_at IS NULL AND status = 'PENDENTE'
        ORDER BY created_at, id LIMIT ${limite} FOR UPDATE SKIP LOCKED`)
      if (!eventos.length) return 0
      const ids = sql.join(
        eventos.map((e) => sql`${e.id}::uuid`),
        sql`, `,
      )
      await tx.execute(sql`
        INSERT INTO entregas_notificacao (notificacao_id, canal, destino)
        SELECT n.id, 'email', 'email' FROM notificacoes n
        JOIN preferencias_notificacao p ON p.usuario_id = n.usuario_destino_id AND p.email
        WHERE n.id IN (${ids})
        ON CONFLICT (notificacao_id, canal, destino) DO NOTHING`)
      await tx.execute(
        sql`UPDATE notificacoes SET processada_at = now() WHERE id IN (${ids})`,
      )
      return eventos.length
    })
  }
  async reservar(limite: number): Promise<Entrega[]> {
    return this.rows<Entrega>(sql`
      WITH lote AS (
        SELECT id FROM entregas_notificacao
        WHERE (estado = 'PENDENTE' AND proxima_at <= now())
           OR (estado = 'PROCESSANDO' AND lease_ate <= now())
        ORDER BY proxima_at, id LIMIT ${limite} FOR UPDATE SKIP LOCKED
      )
      UPDATE entregas_notificacao e SET estado = 'PROCESSANDO',
        lease_id = gen_random_uuid(), lease_ate = now() + interval '120 seconds', tentativas = tentativas + 1
      FROM lote WHERE e.id = lote.id RETURNING e.*`)
  }
  async mensagem(e: Entrega): Promise<Mensagem | null> {
    const [m] = await this.rows<Mensagem>(sql`
      SELECT n.id AS "notificacaoId", n.plantao_id AS "plantaoId", n.tipo, u.email AS destino
      FROM notificacoes n JOIN usuarios u ON u.id = n.usuario_destino_id
      JOIN preferencias_notificacao p ON p.usuario_id = u.id
      WHERE n.id = ${e.notificacao_id}::uuid AND u.status = 'ATIVO' AND u.deleted_at IS NULL
        AND p.email`)
    return m ?? null
  }
  async finalizar(
    e: Entrega,
    estado: string,
    codigo: string | null,
    atraso = 0,
  ) {
    // Fencing: um worker cujo lease foi recuperado não pode sobrescrever o novo dono.
    return this.db.transaction(async (tx) => {
      const repo = new RepositorioEntregas(tx as unknown as Database)
      const alteradas = await repo.rows<{ id: string }>(sql`
      UPDATE entregas_notificacao SET estado = ${estado}, erro_codigo = ${codigo},
        proxima_at = now() + (${atraso} * interval '1 millisecond'),
        enviada_at = CASE WHEN ${estado} = 'ENVIADA' THEN now() ELSE enviada_at END,
        lease_id = NULL, lease_ate = NULL
      WHERE id = ${e.id}::uuid AND lease_id = ${e.lease_id}::uuid AND estado = 'PROCESSANDO'
      RETURNING id`)
      if (!alteradas.length) return false
      await tx.execute(sql`
      UPDATE notificacoes n SET status = 'ENVIADA', enviada_at = now()
      WHERE n.id = ${e.notificacao_id}::uuid
        AND EXISTS (SELECT 1 FROM entregas_notificacao WHERE notificacao_id = n.id)
        AND NOT EXISTS (SELECT 1 FROM entregas_notificacao WHERE notificacao_id = n.id AND estado <> 'ENVIADA')`)
      return true
    })
  }
  async metricasOutbox() {
    const [fila] = await this.rows<{
      total: number
      idade_segundos: number | null
    }>(sql`
      SELECT count(*)::int AS total,
        max(extract(epoch FROM (now() - created_at)))::float AS idade_segundos
      FROM notificacoes WHERE processada_at IS NULL AND status = 'PENDENTE'`)
    return fila
  }
  async metricas() {
    return this.rows<{
      estado: string
      total: number
      idade_segundos: number
    }>(sql`
      SELECT e.estado, count(*)::int AS total,
        max(extract(epoch FROM (now() - n.created_at)))::float AS idade_segundos
      FROM entregas_notificacao e JOIN notificacoes n ON n.id = e.notificacao_id
      GROUP BY e.estado`)
  }
}
