import {
  Body,
  Controller,
  Get,
  Inject,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common'
import { AuthGuard, type AuthenticatedRequest } from '../auth/auth.guard.ts'
import { Permissoes } from '../auth/permissoes.decorator.ts'
import { PermissoesGuard } from '../auth/permissoes.guard.ts'
import { ZodValidationPipe } from '../common/zod-validation.pipe.ts'
import {
  registrarPresencaSchema,
  type RegistrarPresenca,
} from './checkin.schemas.ts'
import { CheckinService } from './checkin.service.ts'

@Controller('presenca')
@UseGuards(AuthGuard, PermissoesGuard)
export class CheckinController {
  constructor(
    @Inject(CheckinService) private readonly checkin: CheckinService,
  ) {}

  @Permissoes('MEDICO')
  @Get('proximos')
  proximos(@Req() request: AuthenticatedRequest) {
    return this.checkin.proximos(request.usuarioId)
  }

  @Permissoes('MEDICO')
  @Post()
  registrar(
    @Req() request: AuthenticatedRequest,
    @Body(new ZodValidationPipe(registrarPresencaSchema))
    dados: RegistrarPresenca,
  ) {
    return this.checkin.registrar(request.usuarioId, dados)
  }
}
