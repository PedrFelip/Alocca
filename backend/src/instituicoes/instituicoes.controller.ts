import { Controller, Get, Inject, Req, UseGuards } from '@nestjs/common'
import { AuthGuard, type AuthenticatedRequest } from '../auth/auth.guard.ts'
import { Permissoes } from '../auth/permissoes.decorator.ts'
import { PermissoesGuard } from '../auth/permissoes.guard.ts'
import { InstituicoesService } from './instituicoes.service.ts'

@Controller('instituicoes')
@UseGuards(AuthGuard, PermissoesGuard)
@Permissoes('GESTOR')
export class InstituicoesController {
  constructor(
    @Inject(InstituicoesService)
    private readonly instituicoes: InstituicoesService,
  ) {}

  /** UC10 — Instituições vinculadas ao gestor logado. */
  @Get('vinculadas')
  vinculadas(@Req() request: AuthenticatedRequest) {
    return this.instituicoes.vinculadas(request.usuarioId)
  }
}
