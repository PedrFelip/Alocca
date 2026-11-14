import { z } from 'zod'
import { emailSchema, senhaSchema } from '../usuarios/usuarios.schemas.ts'

export const loginSchema = z.strictObject({
  email: emailSchema,
  senha: z.string().min(1).max(128),
})

export type Login = z.infer<typeof loginSchema>

// UC04
export const recuperarSenhaSchema = z.strictObject({ email: emailSchema })

export type RecuperarSenha = z.infer<typeof recuperarSenhaSchema>

export const redefinirSenhaSchema = z.strictObject({
  token: z.string().trim().min(1).max(255),
  nova_senha: senhaSchema,
})

export type RedefinirSenha = z.infer<typeof redefinirSenhaSchema>

export const refreshSchema = z.strictObject({
  refresh_token: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
})
export type Refresh = z.infer<typeof refreshSchema>
