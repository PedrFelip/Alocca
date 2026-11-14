import { z } from 'zod'
import { ufSchema } from '../usuarios/usuarios.schemas.ts'

// Query string vazia (ex.: ?valor_max=) deve ser tratada como filtro ausente.
function opcional<T extends z.ZodType>(schema: T) {
  return z.preprocess((value) => (value === '' ? undefined : value), schema)
}

export const listarPlantoesSchema = z
  .strictObject({
    // O feed é sempre de vagas abertas (RN13); aceito para compatibilidade.
    status: z
      .string()
      .trim()
      .toUpperCase()
      .pipe(z.literal('ABERTO'))
      .optional(),
    especialidade: z.string().trim().min(1).max(100).optional(),
    cidade: z.string().trim().min(1).max(100).optional(),
    uf: z.string().trim().toUpperCase().pipe(ufSchema).optional(),
    valor_min: opcional(z.coerce.number().nonnegative().optional()),
    valor_max: opcional(z.coerce.number().nonnegative().optional()),
    limit: opcional(z.coerce.number().int().min(1).max(50).default(20)),
    offset: opcional(z.coerce.number().int().min(0).default(0)),
  })
  .refine(
    (filtros) =>
      filtros.valor_min === undefined ||
      filtros.valor_max === undefined ||
      filtros.valor_min <= filtros.valor_max,
    {
      message: 'valor_min não pode ser maior que valor_max',
      path: ['valor_min'],
    },
  )

export type ListarPlantoes = z.infer<typeof listarPlantoesSchema>

export const statusGerenciadoSchema = z.enum([
  'ABERTO',
  'PREENCHIDO',
  'CANCELADO',
  'CONCLUIDO',
])

// z.coerce.date() aceitaria null/'', virando epoch, e strings inválidas como
// Invalid Date. Exige primeiro uma string parseável; depois converte para Date.
const dataHoraSchema = z
  .string()
  .refine((valor) => !Number.isNaN(new Date(valor).getTime()), {
    message: 'Data e hora inválidas',
  })
  .transform((valor) => new Date(valor))

// numeric(10,2): mínimo de um centavo (0.01) e teto do banco; rejeita mais de
// duas casas decimais para não arredondar silenciosamente.
const valorSchema = z
  .coerce
  .number()
  .min(0.01)
  .max(99_999_999.99)
  .refine((valor) => Number.isInteger(Number((valor * 100).toPrecision(12))), {
    message: 'valor deve ter no máximo 2 casas decimais',
  })

// Contrato atual do app (sem /api/v1, snake_case — ver docs/decisoes-pendentes.md D18).
// Campos obrigatórios da RN24; `titulo` e `descricao` são extras do PR0 (D13).
export const criarPlantaoSchema = z
  .strictObject({
    instituicao_id: z.uuid(),
    titulo: z.string().trim().min(1).max(150).optional(),
    descricao: z.string().trim().min(1).max(2000).optional(),
    local_unidade: z.string().trim().min(1).max(150),
    especialidade: z.string().trim().min(1).max(100),
    data_inicio: dataHoraSchema,
    data_fim: dataHoraSchema,
    valor: valorSchema,
    quantidade_vagas: z.coerce.number().int().min(1).max(10_000),
  })

export type CriarPlantao = z.infer<typeof criarPlantaoSchema>

// Diferente do feed (RN13), o gestor vê os plantões das suas instituições em
// qualquer status; filtros opcionais por instituição e status.
export const listarPlantoesGerenciadosSchema = z.strictObject({
  instituicao_id: z.uuid().optional(),
  status: statusGerenciadoSchema.optional(),
  limit: opcional(z.coerce.number().int().min(1).max(50).default(20)),
  offset: opcional(z.coerce.number().int().min(0).default(0)),
})

export type ListarPlantoesGerenciados = z.infer<
  typeof listarPlantoesGerenciadosSchema
>
