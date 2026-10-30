import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common'
import { z } from 'zod'
import { AuthGuard, type AuthenticatedRequest } from '../auth/auth.guard.ts'
import { Permissoes } from '../auth/permissoes.decorator.ts'
import { PermissoesGuard } from '../auth/permissoes.guard.ts'
import { ZodValidationPipe } from '../common/zod-validation.pipe.ts'
import {
  criarCandidaturaSchema,
  type CriarCandidatura,
} from './candidaturas.schemas.ts'
import {
  listarMinhasCandidaturasSchema,
  type ListarMinhasCandidaturas,
} from './candidaturas.schemas.ts'
import { CandidaturasService } from './candidaturas.service.ts'

const uuidSchema = z.uuid()

@Controller('plantoes/:idPlantao/candidaturas')
@UseGuards(AuthGuard, PermissoesGuard)
export class CandidaturasController {
  constructor(
    @Inject(CandidaturasService)
    private readonly candidaturas: CandidaturasService,
  ) {}

  /** UC05 — Candidatar-se a um plantão do feed. */
  @Permissoes('MEDICO')
  @Post()
  criar(
    @Param('idPlantao', new ZodValidationPipe(uuidSchema)) plantaoId: string,
    @Req() request: AuthenticatedRequest,
    @Body(new ZodValidationPipe(criarCandidaturaSchema)) dados: CriarCandidatura,
  ) {
    return this.candidaturas.criar(plantaoId, request.usuarioId, dados)
  }

  /** UC11 — Lista candidatos do plantão para o gestor. */
  @Permissoes('GESTOR')
  @Get()
  listar(
    @Param('idPlantao', new ZodValidationPipe(uuidSchema)) plantaoId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.candidaturas.listar(plantaoId, request.usuarioId)
  }

  /** UC11 — Aprova candidato e aloca (transação atômica). */
  @Permissoes('GESTOR')
  @Post(':idCandidatura/aprovar')
  @HttpCode(200)
  aprovar(
    @Param('idPlantao', new ZodValidationPipe(uuidSchema)) plantaoId: string,
    @Param('idCandidatura', new ZodValidationPipe(uuidSchema))
    candidaturaId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.candidaturas.aprovar(
      plantaoId,
      candidaturaId,
      request.usuarioId,
    )
  }
}

@Controller('candidaturas/medico')
@UseGuards(AuthGuard, PermissoesGuard)
@Permissoes('MEDICO')
export class MinhasCandidaturasController {
  constructor(
    @Inject(CandidaturasService)
    private readonly candidaturas: CandidaturasService,
  ) {}

  @Get()
  listar(
    @Req() request: AuthenticatedRequest,
    @Query(
      new ZodValidationPipe(listarMinhasCandidaturasSchema),
    )
    filtros: ListarMinhasCandidaturas,
  ) {
    return this.candidaturas.listarMinhas(request.usuarioId, filtros)
  }
}
