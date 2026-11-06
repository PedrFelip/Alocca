import { Controller, Get, Inject, Req, UseGuards } from '@nestjs/common'
import { AuthGuard, type AuthenticatedRequest } from '../auth/auth.guard.ts'
import { Permissoes } from '../auth/permissoes.decorator.ts'
import { PermissoesGuard } from '../auth/permissoes.guard.ts'
import { FinanceiroService } from './financeiro.service.ts'

@Controller('financeiro')
@UseGuards(AuthGuard, PermissoesGuard)
export class FinanceiroController {
  constructor(
    @Inject(FinanceiroService) private readonly financeiro: FinanceiroService,
  ) {}

  @Permissoes('MEDICO')
  @Get('medico')
  doMedico(@Req() request: AuthenticatedRequest) {
    return this.financeiro.doMedico(request.usuarioId)
  }
}
