import { Controller, Get, Inject, Query, Req, UseGuards } from '@nestjs/common'
import { AuthGuard, type AuthenticatedRequest } from '../auth/auth.guard.ts'
import { Permissoes } from '../auth/permissoes.decorator.ts'
import { PermissoesGuard } from '../auth/permissoes.guard.ts'
import { ZodValidationPipe } from '../common/zod-validation.pipe.ts'
import {
  consultarPresencaSchema,
  historicoPresencaSchema,
  type ConsultarPresenca,
  type HistoricoPresenca,
} from './presenca.schemas.ts'
import { PresencaService } from './presenca.service.ts'

@Controller('presenca')
@UseGuards(AuthGuard, PermissoesGuard)
export class PresencaController {
  constructor(
    @Inject(PresencaService) private readonly presenca: PresencaService,
  ) {}

  @Permissoes('MEDICO')
  @Get()
  daAlocacao(
    @Req() request: AuthenticatedRequest,
    @Query(new ZodValidationPipe(consultarPresencaSchema)) consulta: ConsultarPresenca,
  ) {
    return this.presenca.daAlocacao(request.usuarioId, consulta)
  }

  @Permissoes('MEDICO')
  @Get('historico')
  historico(
    @Req() request: AuthenticatedRequest,
    @Query(new ZodValidationPipe(historicoPresencaSchema)) paginacao: HistoricoPresenca,
  ) {
    return this.presenca.historico(request.usuarioId, paginacao)
  }
}
