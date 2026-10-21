import {
  Body,
  Controller,
  Get,
  Inject,
  Param,
  Patch,
  Req,
  UseGuards,
} from '@nestjs/common'
import { z } from 'zod'
import { AuthGuard, type AuthenticatedRequest } from '../auth/auth.guard.ts'
import { Permissoes } from '../auth/permissoes.decorator.ts'
import { PermissoesGuard } from '../auth/permissoes.guard.ts'
import { ZodValidationPipe } from '../common/zod-validation.pipe.ts'
import {
  decidirValidacaoSchema,
  type DecidirValidacao,
} from './medicos.schemas.ts'
import { MedicosService } from './medicos.service.ts'

const uuidSchema = z.uuid()

@Controller('admin/medicos')
@UseGuards(AuthGuard, PermissoesGuard)
@Permissoes('ADMIN')
export class MedicosController {
  constructor(
    @Inject(MedicosService) private readonly medicos: MedicosService,
  ) {}

  @Get('pendentes')
  pendentes() {
    return this.medicos.pendentes()
  }

  @Patch(':medicoId/validacao')
  decidir(
    @Param('medicoId', new ZodValidationPipe(uuidSchema)) medicoId: string,
    @Req() request: AuthenticatedRequest,
    @Body(new ZodValidationPipe(decidirValidacaoSchema))
    decision: DecidirValidacao,
  ) {
    return this.medicos.decidir(medicoId, request.usuarioId, decision)
  }
}
