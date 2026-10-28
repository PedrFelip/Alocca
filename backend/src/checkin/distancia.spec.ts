import { distanciaEmMetros } from './distancia.ts'

const hospital = { lat: -15.7942, lon: -47.8822 }

describe('distanciaEmMetros', () => {
  it('retorna zero para o mesmo ponto', () => {
    expect(
      distanciaEmMetros(hospital.lat, hospital.lon, hospital.lat, hospital.lon),
    ).toBe(0)
  })

  it('calcula cerca de 111 km para 1 grau de latitude', () => {
    expect(distanciaEmMetros(0, 0, 1, 0)).toBeCloseTo(111195, 0)
  })
})
