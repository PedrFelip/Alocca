import {
  Body,
  Controller,
  Get,
  Inject,
  Post,
  Patch,
  Param,
  ParseUUIDPipe,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common'
import { AuthGuard, type AuthenticatedRequest } from '../auth/auth.guard.ts'
import { Permissoes } from '../auth/permissoes.decorator.ts'
import { PermissoesGuard } from '../auth/permissoes.guard.ts'
import { mensagensOficiais } from '../common/mensagens.ts'
import { ZodValidationPipe } from '../common/zod-validation.pipe.ts'
import {
  criarPlantaoSchema,
  editarPlantaoSchema,
  type EditarPlantao,
  listarPlantoesGerenciadosSchema,
  listarPlantoesSchema,
  type CriarPlantao,
  type ListarPlantoes,
  type ListarPlantoesGerenciados,
} from './plantoes.schemas.ts'
import { PlantoesService } from './plantoes.service.ts'

@Controller('plantoes')
@UseGuards(AuthGuard, PermissoesGuard)
export class PlantoesController {
  constructor(
    @Inject(PlantoesService) private readonly plantoes: PlantoesService,
  ) {}

  @Get()
  @Permissoes('MEDICO')
  listar(
    @Req() request: AuthenticatedRequest,
    @Query(new ZodValidationPipe(listarPlantoesSchema)) filtros: ListarPlantoes,
  ) {
    return this.plantoes.listar(request.usuarioId, filtros)
  }

  /** UC10 — Publicação de plantão pelo gestor (MSG-14, MSG-15). */
  @Permissoes('GESTOR')
  @Post()
  criar(
    @Req() request: AuthenticatedRequest,
    @Body(
      new ZodValidationPipe(criarPlantaoSchema, mensagensOficiais['MSG-15']),
    )
    dados: CriarPlantao,
  ) {
    return this.plantoes.criar(request.usuarioId, dados)
  }

  /** UC10 — Plantões das instituições administradas pelo gestor logado. */
  @Permissoes('GESTOR')
  @Get('gerenciados')
  listarGerenciados(
    @Req() request: AuthenticatedRequest,
    @Query(new ZodValidationPipe(listarPlantoesGerenciadosSchema))
    filtros: ListarPlantoesGerenciados,
  ) {
    return this.plantoes.listarGerenciados(request.usuarioId, filtros)
  }
  @Get('medicos-convidaveis')
  @Permissoes('GESTOR')
  medicosConvidaveis(
    @Req() request: AuthenticatedRequest,
    @Query('instituicao_id', new ParseUUIDPipe()) instituicaoId: string,
  ) {
    return this.plantoes.medicosConvidaveis(request.usuarioId, instituicaoId)
  }
  @Patch(':id')
  @Permissoes('GESTOR')
  editar(
    @Req() request: AuthenticatedRequest,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodValidationPipe(editarPlantaoSchema)) dados: EditarPlantao,
  ) {
    return this.plantoes.editar(request.usuarioId, id, dados)
  }

  @Post(':id/cancelar')
  @Permissoes('GESTOR')
  cancelar(
    @Req() request: AuthenticatedRequest,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.plantoes.encerrar(request.usuarioId, id, 'CANCELADO')
  }

  @Post(':id/concluir')
  @Permissoes('GESTOR')
  concluir(
    @Req() request: AuthenticatedRequest,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.plantoes.encerrar(request.usuarioId, id, 'CONCLUIDO')
  }
}
