import {
  Body,
  Controller,
  Get,
  Inject,
  Param,
  Patch,
  Put,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common'
import { z } from 'zod'
import { AuthGuard, type AuthenticatedRequest } from '../auth/auth.guard.ts'
import { ZodValidationPipe } from '../common/zod-validation.pipe.ts'
import { NotificacoesService } from './notificacoes.service.ts'

const preferenciasSchema = z
  .object({ push: z.boolean(), email: z.boolean() })
  .strict()
const idSchema = z.uuid()
const listaSchema = z
  .object({
    limite: z.coerce.number().int().min(1).max(100).default(20),
    cursor: z.uuid().optional(),
    somente_nao_lidas: z.enum(['true', 'false']).optional(),
  })
  .strict()

@Controller('notificacoes')
@UseGuards(AuthGuard)
export class NotificacoesController {
  constructor(
    @Inject(NotificacoesService) private readonly service: NotificacoesService,
  ) {}

  @Get()
  listar(
    @Req() req: AuthenticatedRequest,
    @Query(new ZodValidationPipe(listaSchema)) query: z.infer<
      typeof listaSchema
    >,
  ) {
    return this.service.listar(
      req.usuarioId,
      query.limite,
      query.cursor,
      query.somente_nao_lidas === 'true',
    )
  }

  @Get('plantoes/:id')
  detalhePlantao(
    @Req() req: AuthenticatedRequest,
    @Param('id', new ZodValidationPipe(idSchema)) id: string,
  ) {
    return this.service.detalhePlantao(req.usuarioId, id)
  }

  @Get('preferencias')
  preferencias(@Req() req: AuthenticatedRequest) {
    return this.service.preferencias(req.usuarioId)
  }

  @Put('preferencias')
  atualizar(
    @Req() req: AuthenticatedRequest,
    @Body(new ZodValidationPipe(preferenciasSchema)) data: z.infer<
      typeof preferenciasSchema
    >,
  ) {
    return this.service.atualizarPreferencias(req.usuarioId, data)
  }

  @Patch(':id/lida')
  ler(
    @Req() req: AuthenticatedRequest,
    @Param('id', new ZodValidationPipe(idSchema)) id: string,
  ) {
    return this.service.ler(req.usuarioId, id)
  }
}
