import {
  Inject,
  Injectable,
  InternalServerErrorException,
  UnauthorizedException,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common'
import { createHash } from 'node:crypto'
import { JwtService } from '@nestjs/jwt'
import { and, eq, isNull, sql } from 'drizzle-orm'
import type { Request } from 'express'
import { z } from 'zod'
import { DRIZZLE_DB, type Database } from '../db/db.provider.ts'
import { usuariosTable } from '../db/schemas/usuarios.ts'
import { sessoesAuthTable } from '../db/schemas/sessoes-auth.ts'

export type AuthenticatedRequest = Request & {
  sessaoHash: string
  sessaoExpiraEm: Date
  sessaoId?: string
  usuarioId: string
  tipoUsuario: 'MEDICO' | 'GESTOR' | 'ADMIN'
}

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    @Inject(JwtService) private readonly jwt: JwtService,
    @Inject(DRIZZLE_DB) private readonly db: Database,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>()
    const match = /^Bearer ([^\s]+)$/i.exec(request.headers.authorization ?? '')
    if (!match) throw new UnauthorizedException('Autenticação necessária')
    let usuarioId: string
    let sessaoId: string | undefined
    try {
      const payload = await this.jwt.verifyAsync<{
        sub: string
        exp: number
        sid?: string
      }>(match[1], {
        algorithms: ['HS256'],
      })
      usuarioId = z.uuid().parse(payload.sub)
      sessaoId =
        payload.sid === undefined ? undefined : z.uuid().parse(payload.sid)
      request.sessaoHash = createHash('sha256').update(match[1]).digest('hex')
      request.sessaoExpiraEm = new Date(
        z.number().int().positive().parse(payload.exp) * 1000,
      )
    } catch {
      throw new UnauthorizedException('Token inválido ou expirado')
    }
    const [usuario] = await this.db
      .select({ id: usuariosTable.id, tipo: usuariosTable.tipo })
      .from(usuariosTable)
      .where(
        and(
          eq(usuariosTable.id, usuarioId),
          eq(usuariosTable.status, 'ATIVO'),
          isNull(usuariosTable.deleted_at),
          sessaoId
            ? sql`EXISTS (SELECT 1 FROM ${sessoesAuthTable} s WHERE s.id = ${sessaoId} AND s.usuario_id = ${usuarioId} AND s.revogado_at IS NULL)`
            : sql`${usuariosTable.tokens_revogados_at} IS NULL AND NOT EXISTS (SELECT 1 FROM ${sessoesAuthTable} s WHERE s.token_hash = ${request.sessaoHash} AND s.revogado_at IS NOT NULL)`,
        ),
      )
      .limit(1)
      .catch(() => {
        throw new InternalServerErrorException()
      })
    if (!usuario) throw new UnauthorizedException('Usuário indisponível')
    request.sessaoId = sessaoId
    request.usuarioId = usuario.id
    request.tipoUsuario = usuario.tipo
    return true
  }
}
