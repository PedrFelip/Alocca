import { mascararEmail, serializarLogCritico } from './log-critico.ts'

describe('log-critico', () => {
  it('mascara o e-mail preservando diagnóstico mínimo sem expor o endereço completo', () => {
    expect(mascararEmail('Maria@Example.com')).toBe('m***@example.com')
    expect(mascararEmail('  jo@example.com  ')).toBe('***@example.com')
    expect(mascararEmail('a@example.com')).toBe('***@example.com')
    expect(mascararEmail('invalido')).toBe('***')
    expect(mascararEmail('a*@example.com')).toBe('***@example.com')
  })

  it('serializa eventos críticos no formato JSON padronizado', () => {
    const json = serializarLogCritico({
      evento: 'LOGIN_FALHO',
      motivo: 'SENHA_INCORRETA',
      usuario_id: 'user-123',
      email_mascarado: 'm***@example.com',
      tentativas_falhas: 2,
    })

    expect(JSON.parse(json)).toEqual({
      evento: 'LOGIN_FALHO',
      motivo: 'SENHA_INCORRETA',
      usuario_id: 'user-123',
      email_mascarado: 'm***@example.com',
      tentativas_falhas: 2,
    })
  })
})
