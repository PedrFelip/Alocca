import {
  ForbiddenException,
  Inject,
  Injectable,
  UnauthorizedException,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import type { AuthenticatedRequest } from './auth.guard.ts'
import {
  PERMISSOES_KEY,
  type PermissaoUsuario,
} from './permissoes.decorator.ts'

@Injectable()
export class PermissoesGuard implements CanActivate {
  constructor(@Inject(Reflector) private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>()
    if (!request.usuarioId || !request.tipoUsuario) {
      throw new UnauthorizedException('Autenticação necessária')
    }

    const tipos = this.reflector.getAllAndOverride<PermissaoUsuario[]>(
      PERMISSOES_KEY,
      [context.getHandler(), context.getClass()],
    )
    if (tipos && !tipos.includes(request.tipoUsuario)) {
      throw new ForbiddenException('Usuário sem permissão para esta ação')
    }
    return true
  }
}
