import { z } from 'zod'
import { ufSchema } from '../usuarios/usuarios.schemas.js'

export const listarPlantoesSchema = z
  .strictObject({
    // O feed é sempre de vagas abertas; aceito para compatibilidade com o contrato.
    status: z
      .string()
      .trim()
      .toUpperCase()
      .pipe(z.literal('ABERTO'))
      .optional(),
    especialidade: z.string().trim().min(1).max(100).optional(),
    cidade: z.string().trim().min(1).max(100).optional(),
    uf: z.string().trim().toUpperCase().pipe(ufSchema).optional(),
    valor_min: z.coerce.number().nonnegative().optional(),
    valor_max: z.coerce.number().nonnegative().optional(),
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
