import { z } from 'zod'
import { emailSchema } from '../usuarios/usuarios.schemas.js'

export const loginSchema = z.strictObject({
  email: emailSchema,
  senha: z.string().min(1).max(128),
})

export type Login = z.infer<typeof loginSchema>
