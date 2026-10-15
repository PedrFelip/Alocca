import {
  Inject,
  Injectable,
  UnauthorizedException,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'
import { and, eq, isNull } from 'drizzle-orm'
import type { Request } from 'express'
import { z } from 'zod'
import { DRIZZLE_DB, type Database } from '../db/db.provider.js'
import { usuariosTable } from '../db/schemas/index.js'

export type AuthenticatedRequest = Request & {
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
    try {
      const payload = await this.jwt.verifyAsync<{ sub: string }>(match[1], {
        algorithms: ['HS256'],
      })
      usuarioId = z.uuid().parse(payload.sub)
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
        ),
      )
      .limit(1)
    if (!usuario) throw new UnauthorizedException('Usuário indisponível')
    request.usuarioId = usuario.id
    request.tipoUsuario = usuario.tipo
    return true
  }
}
