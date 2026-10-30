import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  Logger,
} from "@nestjs/common";
import type { Response } from "express";
import { codigoDaMensagem } from "./mensagens.ts";

@Catch()
export class FiltroMensagens implements ExceptionFilter {
  private readonly logger = new Logger(FiltroMensagens.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const resposta = host.switchToHttp().getResponse<Response>();

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const original = exception.getResponse();
      const corpo =
        typeof original === "string"
          ? { statusCode: status, message: original }
          : (original as Record<string, unknown>);
      const mensagem = typeof corpo.message === "string" ? corpo.message : "";
      const codigo = codigoDaMensagem(mensagem);
      resposta.status(status).json({
        ...corpo,
        ...(codigo ? { code: codigo } : {}),
        status,
      });
      return;
    }

    const erroHttp = erroHttpReconhecido(exception);
    if (erroHttp) {
      resposta.status(erroHttp.status).json({
        statusCode: erroHttp.status,
        message: erroHttp.message,
        status: erroHttp.status,
      });
      return;
    }

    this.logger.error(
      exception instanceof Error ? exception.stack : String(exception),
    );
    resposta.status(500).json({
      statusCode: 500,
      message: "Internal server error",
      status: 500,
    });
  }
}

/**
 * Erros HTTP 4xx lançados fora do Nest (ex.: body-parser/http-errors, como
 * `PayloadTooLargeError` com status 413) não são `HttpException`, mas expõem
 * `status` e `expose`. Falhas inesperadas continuam caindo no 500 genérico.
 */
function erroHttpReconhecido(
  exception: unknown,
): { status: number; message: string } | null {
  if (!(exception instanceof Error)) return null;
  const { status, expose } = exception as Error & {
    status?: unknown;
    expose?: unknown;
  };
  if (
    typeof status !== "number" ||
    status < 400 ||
    status >= 500 ||
    expose !== true
  ) {
    return null;
  }
  return { status, message: exception.message };
}
