import {
  Body,
  Put,
  Controller,
  HttpCode,
  Header,
  Get,
  Inject,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  StreamableFile,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common'
import { z } from 'zod'
import { ZodValidationPipe } from '../common/zod-validation.pipe.ts'
import { FileInterceptor } from '@nestjs/platform-express'
import { AuthGuard, type AuthenticatedRequest } from '../auth/auth.guard.ts'
import { Permissoes } from '../auth/permissoes.decorator.ts'
import { PermissoesGuard } from '../auth/permissoes.guard.ts'
import { FinanceiroService } from './financeiro.service.ts'
import type { ArquivoComprovante } from './comprovante.ts'
import { MAX_COMPROVANTE } from './comprovantes.storage.ts'

@Controller('financeiro')
@UseGuards(AuthGuard, PermissoesGuard)
export class FinanceiroController {
  constructor(
    @Inject(FinanceiroService) private readonly financeiro: FinanceiroService,
  ) {}

  @Permissoes('MEDICO')
  @Get('medico')
  doMedico(@Req() request: AuthenticatedRequest) {
    return this.financeiro.doMedico(request.usuarioId)
  }

  @Permissoes('GESTOR')
  @Get('pagamentos')
  pagamentos(@Req() request: AuthenticatedRequest) {
    return this.financeiro.pagamentosGestor(request.usuarioId)
  }

  @Permissoes('GESTOR')
  @Put('pagamentos/:id/vencimento')
  vencimento(
    @Req() request: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(
      new ZodValidationPipe(
        z
          .object({
            vencimento_em: z.iso.datetime({ offset: true }).nullable(),
          })
          .strict(),
      ),
    )
    body: { vencimento_em: string | null },
  ) {
    return this.financeiro.definirVencimento(
      request.usuarioId,
      id,
      body.vencimento_em,
    )
  }

  @Permissoes('GESTOR')
  @Get('pendentes-baixa')
  pendentes(@Req() request: AuthenticatedRequest) {
    return this.financeiro.pendentesBaixa(request.usuarioId)
  }

  @Permissoes('GESTOR')
  @Post('pagamentos/:id/dar-baixa')
  @HttpCode(200)
  @UseInterceptors(
    FileInterceptor('comprovante', {
      limits: { fileSize: MAX_COMPROVANTE, files: 1, fields: 0 },
    }),
  )
  async darBaixa(
    @Req() request: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @UploadedFile() arquivo?: ArquivoComprovante,
  ) {
    return this.financeiro.darBaixa(request.usuarioId, id, arquivo)
  }

  @Permissoes('MEDICO', 'GESTOR')
  @Get('comprovantes/:id')
  @Header('Cache-Control', 'private, no-store')
  @Header('X-Content-Type-Options', 'nosniff')
  async comprovante(
    @Req() request: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const arquivo = await this.financeiro.comprovante(
      request.usuarioId,
      id,
      request.tipoUsuario === 'GESTOR',
    )
    return new StreamableFile(arquivo.buffer, {
      type: arquivo.mime,
      disposition: `attachment; filename="${arquivo.nome}"`,
      length: arquivo.buffer.length,
    })
  }
}
