import { z } from 'zod'
import { StatusUsuario } from '../db/schemas/usuarios.ts'
import { statusValidacaoMedico } from '../db/schemas/medicos.ts'
import { tipoEventoPresenca } from '../db/schemas/registros-ponto.ts'
import { ufSchema } from '../usuarios/usuarios.schemas.ts'

const pagina = {
  instituicao_id: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  offset: z.coerce.number().int().min(0).default(0),
}
const texto = z.string().trim().min(1).max(150).optional()
const instante = z
  .string()
  .datetime({ offset: true })
  .refine((value) => Number.isFinite(Date.parse(value)))

export const consultaMedicosSchema = z.strictObject({
  ...pagina,
  q: texto,
  especialidade: texto,
  status: z.enum(StatusUsuario.enumValues).optional(),
  status_validacao: z.enum(statusValidacaoMedico.enumValues).optional(),
  uf_crm: z.string().trim().toUpperCase().pipe(ufSchema).optional(),
})

export const consultaPontoSchema = z
  .strictObject({
    ...pagina,
    medico_id: z.string().uuid().optional(),
    inicio: instante.optional(),
    fim: instante.optional(),
    tipo_evento: z.enum(tipoEventoPresenca.enumValues).optional(),
  })
  .refine(
    (f) => !f.inicio || !f.fim || Date.parse(f.inicio) < Date.parse(f.fim),
    {
      message: 'inicio deve ser anterior a fim',
    },
  )

export type ConsultaMedicos = z.infer<typeof consultaMedicosSchema>
export type ConsultaPonto = z.infer<typeof consultaPontoSchema>
