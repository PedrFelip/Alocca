import { validateEnv } from './env.ts'

const required = {
  JWT_SECRET: 'test-only-secret-with-at-least-32-characters',
  DATABASE_URL: 'postgresql://localhost/alocca_test',
}

describe('validateEnv', () => {
  it('aceita cache e filas no mesmo Redis com bancos lógicos separados', () => {
    const env = validateEnv({
      ...required,
      REDIS_URL: 'redis://localhost:6379/0',
      QUEUE_REDIS_URL: 'redis://localhost:6379/1',
    })
    expect(env.QUEUE_REDIS_URL).toBe('redis://localhost:6379/1')
    expect(env.QUEUE_PREFIX).toBe('alocca')
    expect(env.QUEUE_CONCURRENCY).toBe(5)
    expect(env.QUEUE_RECONCILE_MS).toBe(5000)
    expect(env.QUEUE_TEST_ENABLED).toBe('false')
    expect(
      validateEnv({ ...required, QUEUE_REDIS_URL: '' }).QUEUE_REDIS_URL,
    ).toBeUndefined()
    for (const config of [
      { QUEUE_REDIS_URL: 'https://localhost' },
      { QUEUE_CONCURRENCY: 0 },
      { QUEUE_RECONCILE_MS: 0 },
      { QUEUE_PREFIX: 'ambiente:invalido' },
    ])
      expect(() => validateEnv({ ...required, ...config })).toThrow()
  })
  it('cache é opcional e tem retenção configurável em segundos', () => {
    expect(validateEnv(required).REDIS_URL).toBeUndefined()
    expect(
      validateEnv({ ...required, REDIS_URL: '' }).REDIS_URL,
    ).toBeUndefined()
    expect(validateEnv(required).CACHE_TTL_SECONDS).toBe(60)
    expect(
      validateEnv({ ...required, CACHE_TTL_SECONDS: '120' }).CACHE_TTL_SECONDS,
    ).toBe(120)
    expect(
      validateEnv({ ...required, REDIS_URL: 'rediss://cache.example:6379' })
        .REDIS_URL,
    ).toBe('rediss://cache.example:6379')
    for (const ttl of [0, -1, 1.5, 86401, 'abc']) {
      expect(() =>
        validateEnv({ ...required, CACHE_TTL_SECONDS: ttl }),
      ).toThrow()
    }
    expect(() =>
      validateEnv({ ...required, REDIS_URL: 'https://cache.example' }),
    ).toThrow()
  })
  it('escuta somente a própria máquina por padrão', () => {
    expect(validateEnv(required).HOST).toBe('127.0.0.1')
  })

  it('permite habilitar acesso pela rede explicitamente', () => {
    expect(validateEnv({ ...required, HOST: '0.0.0.0' }).HOST).toBe('0.0.0.0')
  })

  it('desabilita confiança em proxies por padrão e aceita configuração explícita', () => {
    expect(validateEnv(required).TRUST_PROXY).toBe('')
    expect(
      validateEnv({ ...required, TRUST_PROXY: 'loopback' }).TRUST_PROXY,
    ).toBe('loopback')
  })

  it('rejeita configuração de host vazia', () => {
    expect(() => validateEnv({ ...required, HOST: ' ' })).toThrow(
      /HOST: Too small/,
    )
  })
})
