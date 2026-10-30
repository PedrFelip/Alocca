import { z } from 'zod'

// Caso o gps seja negado a longitude e latitude vem null (RN19)
// gps fora do mapa nao da 400, o service salva sem localizacao (issue #17)
export const registrarPresencaSchema = z.strictObject({
  alocacao_id: z.uuid(),
  tipo_evento: z.enum(['ENTRADA', 'SAIDA']),
  latitude: z.number().nullish(),
  longitude: z.number().nullish(),
  precisao_metros: z.number().nullish(),
})

export type RegistrarPresenca = z.infer<typeof registrarPresencaSchema>
