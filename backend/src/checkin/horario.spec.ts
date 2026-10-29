import { podeFazerCheckin, podeFazerCheckout } from './horario.ts'

const inicio = new Date('2026-11-01T19:00:00Z')
const fim = new Date('2026-11-02T07:00:00Z')

describe('podeFazerCheckin', () => {
  it('libera 10 minutos antes do inicio', () => {
    expect(
      podeFazerCheckin(inicio, fim, new Date('2026-11-01T18:50:00Z')),
    ).toBe(true)
    expect(
      podeFazerCheckin(inicio, fim, new Date('2026-11-01T18:49:00Z')),
    ).toBe(false)
  })

  it('fecha no fim do plantao', () => {
    expect(
      podeFazerCheckin(inicio, fim, new Date('2026-11-02T06:59:00Z')),
    ).toBe(true)
    expect(
      podeFazerCheckin(inicio, fim, new Date('2026-11-02T07:01:00Z')),
    ).toBe(false)
  })
})

describe('podeFazerCheckout', () => {
  it('vai ate 45 minutos depois do fim', () => {
    expect(podeFazerCheckout(fim, new Date('2026-11-02T07:45:00Z'))).toBe(true)
    expect(podeFazerCheckout(fim, new Date('2026-11-02T07:46:00Z'))).toBe(false)
  })
})
