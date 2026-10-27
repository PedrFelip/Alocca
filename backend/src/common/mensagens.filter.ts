import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  Logger,
} from '@nestjs/common'
import type { Response } from 'express'
import { codigoDaMensagem } from './mensagens.ts'

@Catch()
export class FiltroMensagens implements ExceptionFilter {
  private readonly logger = new Logger(FiltroMensagens.name)

  catch(exception: unknown, host: ArgumentsHost) {
    const resposta = host.switchToHttp().getResponse<Response>()

    if (exception instanceof HttpException) {
      const status = exception.getStatus()
      const original = exception.getResponse()
      const corpo =
        typeof original === 'string'
          ? { statusCode: status, message: original }
          : (original as Record<string, unknown>)
      const mensagem =
        typeof corpo.message === 'string' ? corpo.message : ''
      const codigo = codigoDaMensagem(mensagem)
      resposta.status(status).json({
        ...corpo,
        ...(codigo ? { code: codigo } : {}),
        status,
      })
      return
    }

    this.logger.error(
      exception instanceof Error ? exception.stack : String(exception),
    )
    resposta.status(500).json({
      statusCode: 500,
      message: 'Internal server error',
      status: 500,
    })
  }
}
