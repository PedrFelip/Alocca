import { Inject, Injectable, NotFoundException } from '@nestjs/common'
import { and, eq, isNull } from 'drizzle-orm'
import { DRIZZLE_DB, type Database } from '../db/db.provider.ts'
import { medicosTable } from '../db/schemas/index.ts'

@Injectable()
export class PerfilMedicoService {
  constructor(@Inject(DRIZZLE_DB) private readonly db: Database) {}

  async idDoUsuario(usuarioId: string) {
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
    return medico.id
  }
}
