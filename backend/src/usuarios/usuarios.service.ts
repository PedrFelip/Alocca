import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import { and, eq, isNull, sql } from 'drizzle-orm'
import { PasswordService } from '../auth/password.service.js'
import { DRIZZLE_DB, type Database } from '../db/db.provider.js'
import { medicosTable, usuariosTable } from '../db/schemas/index.js'
import type { AtualizarUsuario, CadastroMedico } from './usuarios.schemas.js'

export type Usuario = typeof usuariosTable.$inferSelect

export function usuarioPublico(usuario: Usuario) {
  const { senha_hash: _senha, ...publico } = usuario
  return publico
}

function tratarConflito(error: unknown): never {
  // Drizzle mantém o erro do PostgreSQL em cause.
  let cause = error
  while (cause instanceof Error && cause.cause) cause = cause.cause
  if (
    typeof cause === 'object' &&
    cause !== null &&
    'code' in cause &&
    cause.code === '23505'
  ) {
    throw new ConflictException('E-mail ou CRM/UF já cadastrado')
  }
  throw error
}

@Injectable()
export class UsuariosService {
  constructor(
    @Inject(DRIZZLE_DB) private readonly db: Database,
    @Inject(PasswordService) private readonly passwords: PasswordService,
  ) {}

  async cadastrarMedico(data: CadastroMedico) {
    const senha_hash = await this.passwords.hash(data.senha)
    try {
      return await this.db.transaction(async (tx) => {
        const [usuario] = await tx
          .insert(usuariosTable)
          .values({
            nome: data.nome,
            email: data.email,
            senha_hash,
            telefone: data.telefone,
            tipo: 'MEDICO',
          })
          .returning()
        const [medico] = await tx
          .insert(medicosTable)
          .values({
            usuario_id: usuario.id,
            crm: data.crm,
            uf_crm: data.uf_crm,
            especialidade: data.especialidade,
          })
          .returning()
        return { ...usuarioPublico(usuario), medico }
      })
    } catch (error) {
      tratarConflito(error)
    }
  }

  async buscarCredenciais(email: string): Promise<Usuario | undefined> {
    const [usuario] = await this.db
      .select()
      .from(usuariosTable)
      .where(
        and(
          sql`lower(${usuariosTable.email}) = ${email}`,
          isNull(usuariosTable.deleted_at),
        ),
      )
      .limit(1)
    return usuario
  }

  async registrarLogin(id: string): Promise<void> {
    await this.db
      .update(usuariosTable)
      .set({ ultimo_login_at: new Date() })
      .where(eq(usuariosTable.id, id))
  }

  async perfil(id: string) {
    const [usuario] = await this.db
      .select()
      .from(usuariosTable)
      .where(and(eq(usuariosTable.id, id), isNull(usuariosTable.deleted_at)))
      .limit(1)
    if (!usuario) throw new NotFoundException('Usuário não encontrado')
    const [medico] = await this.db
      .select()
      .from(medicosTable)
      .where(
        and(eq(medicosTable.usuario_id, id), isNull(medicosTable.deleted_at)),
      )
      .limit(1)
    return { ...usuarioPublico(usuario), medico: medico ?? null }
  }

  async atualizarPerfil(id: string, data: AtualizarUsuario) {
    try {
      await this.db.transaction(async (tx) => {
        const { especialidade, crm, uf_crm, ...usuario } = data
        if (Object.keys(usuario).length > 0) {
          await tx
            .update(usuariosTable)
            .set(usuario)
            .where(eq(usuariosTable.id, id))
        }
        if (
          especialidade === undefined &&
          crm === undefined &&
          uf_crm === undefined
        )
          return

        const [medico] = await tx
          .select()
          .from(medicosTable)
          .where(
            and(
              eq(medicosTable.usuario_id, id),
              isNull(medicosTable.deleted_at),
            ),
          )
          .for('update')
          .limit(1)
        if (!medico) throw new NotFoundException('Perfil médico não encontrado')

        const novoCrm = crm ?? medico.crm
        const novaUf = uf_crm ?? medico.uf_crm
        const registroAlterado =
          novoCrm !== medico.crm || novaUf !== medico.uf_crm
        await tx
          .update(medicosTable)
          .set({
            crm: novoCrm,
            uf_crm: novaUf,
            ...(especialidade !== undefined && { especialidade }),
            ...(registroAlterado && {
              status_validacao: 'PENDENTE' as const,
              validado_por_usuario_id: null,
              validado_at: null,
              motivo_rejeicao: null,
            }),
          })
          .where(eq(medicosTable.id, medico.id))
      })
    } catch (error) {
      tratarConflito(error)
    }
    return this.perfil(id)
  }
}
