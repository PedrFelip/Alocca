import { BadRequestException, type PipeTransform } from '@nestjs/common'
import type { z } from 'zod'

export class ZodValidationPipe<T> implements PipeTransform<unknown, T> {
  constructor(
    private readonly schema: z.ZodType<T>,
    // Mensagem oficial (MSG-XX) quando o endpoint tem uma própria; o filtro
    // global adiciona o `code` correspondente.
    private readonly mensagem: string = 'Dados inválidos',
  ) {}

  transform(value: unknown): T {
    const result = this.schema.safeParse(value)
    if (!result.success) {
      throw new BadRequestException({
        message: this.mensagem,
        errors: result.error.flatten(),
      })
    }
    return result.data
  }
}
