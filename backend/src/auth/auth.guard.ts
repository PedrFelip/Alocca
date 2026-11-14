import {
  Inject,
  Injectable,
  UnauthorizedException,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'
import { and, eq, gt, isNull, sql } from 'drizzle-orm'
import type { Request } from 'express'
import { z } from 'zod'
import { DRIZZLE_DB, type Database } from '../db/db.provider.ts'
import { usuariosTable, sessoesMobileTable } from '../db/schemas/index.ts'

export type AuthenticatedRequest = Request & {
  usuarioId: string
  versaoSessao: number
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
    let versaoSessao: number
    let sid: string | undefined
    try {
      const payload = await this.jwt.verifyAsync<{
        sub: string
        versao_sessao?: number
        sid?: string
      }>(match[1], {
        algorithms: ['HS256'],
      })
      usuarioId = z.uuid().parse(payload.sub)
      sid = payload.sid === undefined ? undefined : z.uuid().parse(payload.sid)
      versaoSessao = z
        .number()
        .int()
        .nonnegative()
        .parse(payload.versao_sessao ?? 0)
    } catch {
      throw new UnauthorizedException('Token inválido ou expirado')
    }
    const [usuario] = await this.db
      .select({
        id: usuariosTable.id,
        tipo: usuariosTable.tipo,
        versao: usuariosTable.versao_sessao,
      })
      .from(usuariosTable)
      .where(
        and(
          eq(usuariosTable.id, usuarioId),
          eq(usuariosTable.status, 'ATIVO'),
          isNull(usuariosTable.deleted_at),
        ),
      )
      .limit(1)
    if (!usuario || usuario.versao !== versaoSessao)
      throw new UnauthorizedException('Usuário indisponível')
    if (sid) {
      const [sessao] = await this.db
        .select({ id: sessoesMobileTable.id })
        .from(sessoesMobileTable)
        .where(
          and(
            eq(sessoesMobileTable.id, sid),
            eq(sessoesMobileTable.usuario_id, usuarioId),
            isNull(sessoesMobileTable.revoked_at),
            gt(sessoesMobileTable.expires_at, sql`now()`),
          ),
        )
        .limit(1)
      if (!sessao) throw new UnauthorizedException('Sessão indisponível')
    }
    request.versaoSessao = versaoSessao
    request.usuarioId = usuario.id
    request.tipoUsuario = usuario.tipo
    return true
  }
}
