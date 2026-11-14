import { editarPlantaoSchema } from './plantoes.schemas.ts'

describe('Datas do ciclo de plantões', () => {
  it('mantém o mesmo instante com offset, UTC e formato legado sem fuso', () => {
    const anterior = process.env.TZ
    try {
      process.env.TZ = 'America/Sao_Paulo'
      for (const valor of [
        '2035-01-10T09:00:00-03:00',
        '2035-01-10T12:00:00Z',
        '2035-01-10T12:00:00.000',
      ]) {
        expect(
          editarPlantaoSchema
            .parse({ data_inicio: valor })
            .data_inicio?.toISOString(),
        ).toBe('2035-01-10T12:00:00.000Z')
      }
    } finally {
      if (anterior === undefined) delete process.env.TZ
      else process.env.TZ = anterior
    }
  })
  it.each(['2035-02-30T12:00:00Z', '10/01/2035', '2035-01-10', '', null])(
    'rejeita data ambígua ou inválida: %s',
    (data_inicio) => {
      expect(editarPlantaoSchema.safeParse({ data_inicio }).success).toBe(false)
    },
  )
})
