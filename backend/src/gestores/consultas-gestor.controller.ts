import { Controller, Get, Inject, Query, Req, UseGuards } from '@nestjs/common'
import { AuthGuard, type AuthenticatedRequest } from '../auth/auth.guard.ts'
import { Permissoes } from '../auth/permissoes.decorator.ts'
import { PermissoesGuard } from '../auth/permissoes.guard.ts'
import { ZodValidationPipe } from '../common/zod-validation.pipe.ts'
import {
  historicoPresencaSchema,
  type HistoricoPresenca,
} from '../presenca/presenca.schemas.ts'
import { ConsultasGestorService } from './consultas-gestor.service.ts'

@Controller('gestor')
@UseGuards(AuthGuard, PermissoesGuard)
@Permissoes('GESTOR')
export class ConsultasGestorController {
  constructor(
    @Inject(ConsultasGestorService)
    private readonly consultas: ConsultasGestorService,
  ) {}

  @Get('indicadores')
  indicadores(@Req() request: AuthenticatedRequest) {
    return this.consultas.indicadores(request.usuarioId)
  }

  @Get('medicos')
  medicos(
    @Req() request: AuthenticatedRequest,
    @Query(new ZodValidationPipe(historicoPresencaSchema))
    pagina: HistoricoPresenca,
  ) {
    return this.consultas.medicos(request.usuarioId, pagina)
  }

  @Get('ponto')
  ponto(
    @Req() request: AuthenticatedRequest,
    @Query(new ZodValidationPipe(historicoPresencaSchema))
    pagina: HistoricoPresenca,
  ) {
    return this.consultas.ponto(request.usuarioId, pagina)
  }
}
