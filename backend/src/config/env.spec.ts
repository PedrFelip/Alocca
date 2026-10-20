import { validateEnv } from './env.js'

const required = {
  JWT_SECRET: 'test-only-secret-with-at-least-32-characters',
  DATABASE_URL: 'postgresql://localhost/alocca_test',
}

describe('validateEnv', () => {
  it('escuta somente a própria máquina por padrão', () => {
    expect(validateEnv(required).HOST).toBe('127.0.0.1')
  })

  it('permite habilitar acesso pela rede explicitamente', () => {
    expect(validateEnv({ ...required, HOST: '0.0.0.0' }).HOST).toBe('0.0.0.0')
  })

  it('rejeita configuração de host vazia', () => {
    expect(() => validateEnv({ ...required, HOST: ' ' })).toThrow(
      /HOST: Too small/,
    )
  })
})
