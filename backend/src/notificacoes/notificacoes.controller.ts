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

const paginacao = z
  .object({
    pagina: z.coerce.number().int().min(1).max(1000000).default(1),
    ate: z.iso.datetime().optional(),
    limite: z.coerce.number().int().min(1).max(100).default(20),
  })
  .strict()
const preferencias = z.object({ email_habilitado: z.boolean() }).strict()
@Controller('notificacoes')
@UseGuards(AuthGuard)
export class NotificacoesController {
  constructor(
    @Inject(NotificacoesService) private readonly service: NotificacoesService,
  ) {}
  @Get() listar(
    @Req() req: AuthenticatedRequest,
    @Query(new ZodValidationPipe(paginacao)) query: z.infer<typeof paginacao>,
  ) {
    return this.service.listar(
      req.usuarioId,
      query.pagina,
      query.limite,
      query.ate,
    )
  }
  @Get('preferencias') preferencias(@Req() req: AuthenticatedRequest) {
    return this.service.preferencias(req.usuarioId)
  }
  @Put('preferencias') atualizar(
    @Req() req: AuthenticatedRequest,
    @Body(new ZodValidationPipe(preferencias)) body: z.infer<
      typeof preferencias
    >,
  ) {
    return this.service.atualizarPreferencias(
      req.usuarioId,
      body.email_habilitado,
    )
  }
  @Patch(':id/lida') ler(
    @Req() req: AuthenticatedRequest,
    @Param('id', new ZodValidationPipe(z.uuid())) id: string,
  ) {
    return this.service.ler(req.usuarioId, id)
  }
}
