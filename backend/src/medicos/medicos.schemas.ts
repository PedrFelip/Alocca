import { z } from 'zod'
import { cadastroMedicoSchema } from '../usuarios/usuarios.schemas.ts'

const registro = cadastroMedicoSchema.pick({
  nome: true,
  crm: true,
  uf_crm: true,
}).shape

export const decidirValidacaoSchema = z.discriminatedUnion('status_validacao', [
  z.strictObject({ ...registro, status_validacao: z.literal('APROVADO') }),
  z.strictObject({
    ...registro,
    status_validacao: z.literal('REJEITADO'),
    motivo_rejeicao: z.string().trim().min(3).max(500),
  }),
])

export type DecidirValidacao = z.infer<typeof decidirValidacaoSchema>
