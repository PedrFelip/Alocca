import { z } from 'zod'

/** Mensagem opcional do médico ao se candidatar ao plantão. */
export const criarCandidaturaSchema = z
  .strictObject({
    mensagem: z.string().trim().min(1).max(1000).optional(),
  })
  .optional()

export type CriarCandidatura = z.infer<typeof criarCandidaturaSchema>

function opcional<T extends z.ZodType>(schema: T) {
  return z.preprocess((value) => (value === '' ? undefined : value), schema)
}

const statusCandidaturaSchema = z.enum(['PENDENTE', 'APROVADA', 'REJEITADA'])

export const listarMinhasCandidaturasSchema = z.strictObject({
  status: opcional(
    z
      .string()
      .trim()
      .toUpperCase()
      .pipe(statusCandidaturaSchema)
      .optional(),
  ),
  limit: opcional(z.coerce.number().int().min(1).max(50).default(20)),
  offset: opcional(z.coerce.number().int().min(0).default(0)),
})

export type ListarMinhasCandidaturas = z.infer<
  typeof listarMinhasCandidaturasSchema
>
