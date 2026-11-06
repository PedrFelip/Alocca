import { z } from 'zod'

export const consultarPresencaSchema = z.strictObject({
  alocacao_id: z.string().uuid(),
})

export type ConsultarPresenca = z.infer<typeof consultarPresencaSchema>

export const historicoPresencaSchema = z.strictObject({
  limit: z.coerce.number().int().min(1).max(50).default(20),
  offset: z.coerce.number().int().min(0).default(0),
})

export type HistoricoPresenca = z.infer<typeof historicoPresencaSchema>
