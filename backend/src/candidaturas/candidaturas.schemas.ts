import { z } from 'zod'

/** Mensagem opcional do médico ao se candidatar ao plantão. */
export const criarCandidaturaSchema = z
  .strictObject({
    mensagem: z.string().trim().min(1).max(1000).optional(),
  })
  .optional()

export type CriarCandidatura = z.infer<typeof criarCandidaturaSchema>
