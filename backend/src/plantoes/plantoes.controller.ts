import { Controller, Get, Inject, Query, Req, UseGuards } from '@nestjs/common'
import { AuthGuard, type AuthenticatedRequest } from '../auth/auth.guard.ts'
import { Permissoes } from '../auth/permissoes.decorator.ts'
import { PermissoesGuard } from '../auth/permissoes.guard.ts'
import { ZodValidationPipe } from '../common/zod-validation.pipe.ts'
import {
  listarPlantoesSchema,
  type ListarPlantoes,
} from './plantoes.schemas.ts'
import { PlantoesService } from './plantoes.service.ts'

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
