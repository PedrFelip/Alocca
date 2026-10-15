import { z } from 'zod'

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(z.email().max(255))
export const senhaSchema = z.string().min(8).max(128)
const ufSchema = z.enum([
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

export const cadastroMedicoSchema = z.strictObject({
  nome: z.string().trim().min(2).max(150),
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
