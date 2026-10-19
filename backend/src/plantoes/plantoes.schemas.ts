import { z } from 'zod'
import { ufSchema } from '../usuarios/usuarios.schemas.js'

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
