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
