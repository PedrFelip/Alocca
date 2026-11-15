import { z } from 'zod'

export const detalhesSchema = z.object({
  id: z.string().uuid(),
  nome: z.string(),
  nome_fantasia: z.string().nullable(),
  cnpj: z.string(),
  cidade: z.string().nullable(),
  uf: z.string().nullable(),
  bairro: z.string().nullable(),
  logradouro: z.string().nullable(),
})
export type Detalhes = z.infer<typeof detalhesSchema>
