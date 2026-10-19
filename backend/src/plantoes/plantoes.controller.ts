import { Controller, Get, Inject, Query, Req, UseGuards } from '@nestjs/common'
import { AuthGuard, type AuthenticatedRequest } from '../auth/auth.guard.js'
import { Permissoes } from '../auth/permissoes.decorator.js'
import { PermissoesGuard } from '../auth/permissoes.guard.js'
import { ZodValidationPipe } from '../common/zod-validation.pipe.js'
import {
  listarPlantoesSchema,
  type ListarPlantoes,
} from './plantoes.schemas.js'
import { PlantoesService } from './plantoes.service.js'

@Controller('plantoes')
@UseGuards(AuthGuard, PermissoesGuard)
@Permissoes('MEDICO')
export class PlantoesController {
  constructor(
    @Inject(PlantoesService) private readonly plantoes: PlantoesService,
  ) {}

  @Get()
  listar(
    @Req() request: AuthenticatedRequest,
    @Query(new ZodValidationPipe(listarPlantoesSchema)) filtros: ListarPlantoes,
  ) {
    return this.plantoes.listar(request.usuarioId, filtros)
  }
}
