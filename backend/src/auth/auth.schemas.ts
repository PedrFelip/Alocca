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

export const alterarSenhaSchema = z.strictObject({
  senha_atual: z.string().min(1).max(128),
  nova_senha: senhaSchema,
})

export type AlterarSenha = z.infer<typeof alterarSenhaSchema>

const opaqueToken = z.string().min(1).max(255)
export const challengeSchema = z.strictObject({ challenge_token: opaqueToken })
export const validarPinSchema = challengeSchema.extend({
  pin_code: z.string().regex(/^\d{6}$/),
})
export const refreshSchema = z.strictObject({ refresh_token: opaqueToken })
