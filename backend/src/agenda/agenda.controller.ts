import { Controller, Get, Inject, Query, Req, UseGuards } from '@nestjs/common'
import { AuthGuard, type AuthenticatedRequest } from '../auth/auth.guard.ts'
import { Permissoes } from '../auth/permissoes.decorator.ts'
import { PermissoesGuard } from '../auth/permissoes.guard.ts'
import { ZodValidationPipe } from '../common/zod-validation.pipe.ts'
import {
  agendaDoMesSchema,
  type AgendaDoMes,
} from './agenda.schemas.ts'
import { AgendaService } from './agenda.service.ts'

@Controller('agenda')
@UseGuards(AuthGuard, PermissoesGuard)
export class AgendaController {
  constructor(
    @Inject(AgendaService) private readonly agenda: AgendaService,
  ) {}

  @Permissoes('MEDICO')
  @Get('mes')
  doMes(
    @Req() request: AuthenticatedRequest,
    @Query(new ZodValidationPipe(agendaDoMesSchema)) periodo: AgendaDoMes,
  ) {
    return this.agenda.doMes(request.usuarioId, periodo)
  }
}
