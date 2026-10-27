import { z } from 'zod'
import { higienizarCpf, validarCpf } from '../common/cpf.ts'

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(z.email().max(255))
// RN05 — mínimo de 8 caracteres com maiúscula, minúscula e número.
export const senhaSchema = z
  .string()
  .min(8, 'A senha deve ter no mínimo 8 caracteres')
  .max(128)
  .regex(/[a-z]/, 'A senha deve conter uma letra minúscula')
  .regex(/[A-Z]/, 'A senha deve conter uma letra maiúscula')
  .regex(/\d/, 'A senha deve conter um número')
export const ufSchema = z.enum([
  'AC',
  'AL',
  'AP',
  'AM',
  'BA',
  'CE',
  'DF',
  'ES',
  'GO',
  'MA',
  'MT',
  'MS',
  'MG',
  'PA',
  'PB',
  'PR',
  'PE',
  'PI',
  'RJ',
  'RN',
  'RS',
  'RO',
  'RR',
  'SC',
  'SP',
  'SE',
  'TO',
])

// RN02 — CPF único, validado pelo dígito verificador; RN04 — ponto e hífen removidos.
export const cpfSchema = z
  .string()
  .trim()
  .transform(higienizarCpf)
  .refine(validarCpf, { message: 'CPF inválido' })

export const cadastroMedicoSchema = z.strictObject({
  nome: z.string().trim().min(2).max(150),
  cpf: cpfSchema,
  email: emailSchema,
  senha: senhaSchema,
  telefone: z.string().trim().min(8).max(20).optional(),
  crm: z
    .string()
    .trim()
    .regex(/^\d{1,20}$/, 'CRM deve conter apenas números'),
  uf_crm: z.string().trim().toUpperCase().pipe(ufSchema),
  especialidade: z.string().trim().min(1).max(100).optional(),
})

export const atualizarUsuarioSchema = cadastroMedicoSchema
  .pick({
    nome: true,
    telefone: true,
    especialidade: true,
    crm: true,
    uf_crm: true,
  })
  .partial()
  .refine((data) => Object.keys(data).length > 0, 'Informe pelo menos um campo')
export type CadastroMedico = z.infer<typeof cadastroMedicoSchema>
export type AtualizarUsuario = z.infer<typeof atualizarUsuarioSchema>
