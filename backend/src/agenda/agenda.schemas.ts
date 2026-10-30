import { z } from 'zod'

export const agendaDoMesSchema = z.strictObject({
  ano: z.coerce.number().int().min(2000).max(2100),
  mes: z.coerce.number().int().min(1).max(12),
})

export type AgendaDoMes = z.infer<typeof agendaDoMesSchema>
