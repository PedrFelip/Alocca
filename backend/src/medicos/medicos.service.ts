import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import { and, eq, isNull } from 'drizzle-orm'
import { DRIZZLE_DB, type Database } from '../db/db.provider.js'
import { medicosTable, usuariosTable } from '../db/schemas/index.js'
import type { DecidirValidacao } from './medicos.schemas.js'

@Injectable()
export class MedicosService {
  constructor(@Inject(DRIZZLE_DB) private readonly db: Database) {}

  pendentes() {
    return this.db
      .select({
        medico_id: medicosTable.id,
        usuario_id: usuariosTable.id,
        nome: usuariosTable.nome,
        email: usuariosTable.email,
        crm: medicosTable.crm,
        uf_crm: medicosTable.uf_crm,
        especialidade_declarada: medicosTable.especialidade,
        criado_at: medicosTable.created_at,
      })
      .from(medicosTable)
      .innerJoin(usuariosTable, eq(medicosTable.usuario_id, usuariosTable.id))
      .where(
        and(
          eq(medicosTable.status_validacao, 'PENDENTE'),
          eq(usuariosTable.tipo, 'MEDICO'),
          isNull(medicosTable.deleted_at),
          isNull(usuariosTable.deleted_at),
        ),
      )
  }

  async decidir(medicoId: string, adminId: string, decision: DecidirValidacao) {
    return this.db.transaction(async (tx) => {
      const [row] = await tx
        .select({
          usuario_id: usuariosTable.id,
          nome: usuariosTable.nome,
          tipo: usuariosTable.tipo,
        })
        .from(medicosTable)
        .innerJoin(usuariosTable, eq(medicosTable.usuario_id, usuariosTable.id))
        .where(
          and(
            eq(medicosTable.id, medicoId),
            isNull(medicosTable.deleted_at),
            isNull(usuariosTable.deleted_at),
          ),
        )
        // Perfil também bloqueia usuário antes de médico ao alterar ambos.
        .for('update', { of: usuariosTable })
        .limit(1)
      if (!row) throw new NotFoundException('Médico não encontrado')
      if (row.usuario_id === adminId) {
        throw new ForbiddenException(
          'Não é permitido validar o próprio cadastro',
        )
      }
      if (row.tipo !== 'MEDICO')
        throw new NotFoundException('Médico não encontrado')
      const [medico] = await tx
        .select()
        .from(medicosTable)
        .where(
          and(eq(medicosTable.id, medicoId), isNull(medicosTable.deleted_at)),
        )
        .for('update')
        .limit(1)
      if (!medico) throw new NotFoundException('Médico não encontrado')
      if (medico.status_validacao !== 'PENDENTE') {
        throw new ConflictException('A validação já foi analisada')
      }
      if (row.nome !== decision.nome) {
        throw new ConflictException(
          'Nome alterado; consulte novamente os dados antes de analisar',
        )
      }
      if (medico.crm !== decision.crm || medico.uf_crm !== decision.uf_crm) {
        throw new ConflictException(
          'CRM/UF alterado; consulte novamente os dados antes de analisar',
        )
      }
      const [updated] = await tx
        .update(medicosTable)
        .set({
          status_validacao: decision.status_validacao,
          validado_por_usuario_id: adminId,
          validado_at: new Date(),
          motivo_rejeicao:
            decision.status_validacao === 'REJEITADO'
              ? decision.motivo_rejeicao
              : null,
        })
        .where(eq(medicosTable.id, medicoId))
        .returning()
      return updated
    })
  }
}
