import { z } from 'zod'

// Caso o gps seja negado a longitude e latitude vem null(RN20)
export const registrarPresencaSchema = z.strictObject({
  alocacao_id: z.uuid(),
  tipo_evento: z.enum(['ENTRADA', 'SAIDA']),
  latitude: z.number().min(-90).max(90).nullish(),
  longitude: z.number().min(-180).max(180).nullish(),
  precisao_metros: z.number().min(0).nullish(),
})

export type RegistrarPresenca = z.infer<typeof registrarPresencaSchema>
