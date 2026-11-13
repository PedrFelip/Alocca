import { ForbiddenException, Inject, Injectable } from '@nestjs/common'
import { and, eq, isNull } from 'drizzle-orm'
import { DRIZZLE_DB, type Database } from '../db/db.provider.ts'
import { gestoresTable } from '../db/schemas/index.ts'

/**
 * Perfil de gestor (`gestores`) é consultado por publicação de plantões
 * (UC10), listagem de instituições (UC10) e aprovação de candidaturas (UC11).
 * Centraliza aqui a regra "perfil ativo e não excluído" para as três usarem
 * a mesma semântica de 403.
 */
@Injectable()
export class GestoresService {
  constructor(@Inject(DRIZZLE_DB) private readonly db: Database) {}

  /** Retorna o perfil de gestor ativo do usuário, ou 403 se não existir. */
  async perfilAtivo(usuarioId: string) {
    const [gestor] = await this.db
      .select()
      .from(gestoresTable)
      .where(
        and(
          eq(gestoresTable.usuario_id, usuarioId),
          eq(gestoresTable.ativa, true),
          isNull(gestoresTable.deleted_at),
        ),
      )
      .limit(1)
    if (!gestor) {
      throw new ForbiddenException('Perfil de gestor não encontrado')
    }
    return gestor
  }
}
