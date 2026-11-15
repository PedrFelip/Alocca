import { randomUUID } from 'node:crypto'
import { createClient } from 'redis'
import {
  describe,
  it,
  expect,
  vi,
  beforeAll,
  afterAll,
  afterEach,
} from 'vitest'
import type { ConfigService } from '@nestjs/config'
import type { Env } from '../config/env.ts'
import { CacheService } from './cache.service.ts'

const config = (url?: string) =>
  ({
    get: (name: string) => (name === 'REDIS_URL' ? url : undefined),
  }) as unknown as ConfigService<Env, true>

describe('CacheService sem Redis disponível', () => {
  it('executa o loader a cada leitura e não silencia falha de invalidação', async () => {
    const cache = new CacheService(config())
    const load = vi.fn().mockResolvedValue('banco')
    expect(await cache.getOrLoad('x', 10, load)).toBe('banco')
    expect(await cache.getOrLoad('x', 10, load)).toBe('banco')
    expect(load).toHaveBeenCalledTimes(2)
    await expect(cache.invalidate('x')).rejects.toThrow()
  })

  it('ignora falha de leitura e propaga falha de invalidação', async () => {
    const cache = new CacheService(config())
    const redis = {
      isReady: true,
      withAbortSignal: vi.fn(),
      mGet: vi.fn().mockRejectedValue(new Error('read failed')),
      eval: vi.fn().mockRejectedValue(new Error('write failed')),
    }
    redis.withAbortSignal.mockReturnValue(redis)
    Object.assign(cache, { client: redis })
    expect(await cache.getOrLoad('x', 10, async () => 'banco')).toBe('banco')
    await expect(cache.invalidate('x')).rejects.toThrow('write failed')
  })
})

// Opt-in: CACHE_TEST_REDIS_URL=redis://127.0.0.1:16379 bun run test -- src/cache/cache.service.spec.ts
const redisUrl = process.env.CACHE_TEST_REDIS_URL
const redisSuite = redisUrl ? describe : describe.skip
redisSuite('CacheService com Redis real', () => {
  const prefix = `test:${randomUUID()}`
  const keys = new Set<string>()
  let first: CacheService
  let second: CacheService
  let admin: ReturnType<typeof createClient>
  const key = (name: string) => {
    const result = `${prefix}:${name}`
    keys.add(result)
    return result
  }

  beforeAll(async () => {
    admin = createClient({ url: redisUrl })
    await admin.connect()
    first = new CacheService(config(redisUrl))
    second = new CacheService(config(redisUrl))
    await Promise.all(
      [first, second].map((cache) =>
        (
          cache as unknown as { client: ReturnType<typeof createClient> }
        ).client.connect(),
      ),
    )
  })
  afterEach(async () => {
    const redisKeys = [...keys].flatMap((k) => [
      `alocca:cache:data:${k}`,
      `alocca:cache:version:${k}`,
    ])
    if (redisKeys.length) await admin.del(redisKeys)
    keys.clear()
  })
  afterAll(async () => {
    first?.onModuleDestroy()
    second?.onModuleDestroy()
    if (admin?.isOpen) await admin.close()
  })

  it('compartilha L2, confirma L1 no Redis e devolve cópias independentes', async () => {
    const k = key('shared')
    const load = vi.fn().mockResolvedValue({ name: 'original' })
    await first.getOrLoad(k, 10, load)
    const value = await second.getOrLoad(k, 10, load)
    value.name = 'alterado'
    expect(await second.getOrLoad(k, 10, load)).toEqual({ name: 'original' })
    expect(load).toHaveBeenCalledTimes(1)
    await admin.del(`alocca:cache:data:${k}`)
    expect(
      await second.getOrLoad(k, 10, async () => ({ name: 'novo' })),
    ).toEqual({ name: 'novo' })
  })

  it('expira no Redis e recarrega mesmo após popular L1', async () => {
    const k = key('ttl')
    await first.getOrLoad(k, 1, async () => 'antigo')
    await second.getOrLoad(k, 1, async () => 'inesperado')
    expect(await admin.ttl(`alocca:cache:data:${k}`)).toBeGreaterThanOrEqual(0)
    await new Promise((resolve) => setTimeout(resolve, 1200))
    expect(await second.getOrLoad(k, 10, async () => 'novo')).toBe('novo')
  })

  it('não publica loader pendente após perda dos metadados', async () => {
    const k = key('restart')
    let release!: (value: string) => void
    let started!: () => void
    const ready = new Promise<void>((resolve) => {
      started = resolve
    })
    const pending = first.getOrLoad(k, 10, () => {
      started()
      return new Promise<string>((resolve) => {
        release = resolve
      })
    })
    await ready
    await admin.del([`alocca:cache:data:${k}`, `alocca:cache:version:${k}`])
    expect(await second.getOrLoad(k, 10, async () => 'novo')).toBe('novo')
    release('antigo')
    expect(await pending).toBe('antigo')
    expect(await first.getOrLoad(k, 10, async () => 'erro')).toBe('novo')
  })

  it('renova geração após expiração dos metadados e rejeita publicação antiga', async () => {
    const k = key('generation-expiry')
    let release!: (value: string) => void
    let started!: () => void
    const ready = new Promise<void>((resolve) => {
      started = resolve
    })
    const pending = first.getOrLoad(k, 1, () => {
      started()
      return new Promise<string>((resolve) => {
        release = resolve
      })
    })
    await ready
    expect(await admin.pTTL(`alocca:cache:version:${k}`)).toBeGreaterThan(0)
    await admin.pExpire(`alocca:cache:version:${k}`, 1)
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(await second.getOrLoad(k, 10, async () => 'novo')).toBe('novo')
    release('antigo')
    expect(await pending).toBe('antigo')
    expect(await first.getOrLoad(k, 10, async () => 'erro')).toBe('novo')
  })

  it('não publica valores não serializáveis ou rejeitados pelo decoder', async () => {
    const k = key('serialization')
    expect(await first.getOrLoad(k, 10, async () => 1n)).toBe(1n)
    expect(await admin.exists(`alocca:cache:data:${k}`)).toBe(0)
    const decode = (value: unknown) => {
      if (typeof value !== 'string') throw new Error('inválido')
      return value
    }
    expect(
      await first.getOrLoad(k, 10, async () => 42 as unknown as string, decode),
    ).toBe(42)
    expect(await admin.exists(`alocca:cache:data:${k}`)).toBe(0)
    expect(await second.getOrLoad(k, 10, async () => 'válido', decode)).toBe(
      'válido',
    )
  })

  it('rejeita payload inválido e executa o loader', async () => {
    const k = key('invalid')
    await admin.set(`alocca:cache:version:${k}`, randomUUID(), { EX: 10 })
    await admin.set(`alocca:cache:data:${k}`, '{inválido', { EX: 10 })
    expect(await first.getOrLoad(k, 10, async () => 'fonte')).toBe('fonte')
  })

  it('encerra a conexão e passa a carregar diretamente', async () => {
    const cache = new CacheService(config(redisUrl))
    const client = (
      cache as unknown as { client: ReturnType<typeof createClient> }
    ).client
    await client.connect()
    const k = key('destroy')
    await cache.getOrLoad(k, 10, async () => 'antigo')
    cache.onModuleDestroy()
    expect(client.isOpen).toBe(false)
    expect(await cache.getOrLoad(k, 10, async () => 'novo')).toBe('novo')
  })

  it('invalida dados vistos pela outra instância', async () => {
    const k = key('invalidate')
    await first.getOrLoad(k, 10, async () => 'antigo')
    expect(await second.getOrLoad(k, 10, async () => 'inesperado')).toBe(
      'antigo',
    )
    await first.invalidate(k)
    expect(await second.getOrLoad(k, 10, async () => 'novo')).toBe('novo')
  })

  it('não publica um loader iniciado antes da invalidação', async () => {
    const k = key('race')
    let release!: (value: string) => void
    let started!: () => void
    const loading = new Promise<void>((resolve) => {
      started = resolve
    })
    const old = first.getOrLoad(k, 10, () => {
      started()
      return new Promise<string>((resolve) => {
        release = resolve
      })
    })
    await loading
    await second.invalidate(k)
    release('antigo')
    expect(await old).toBe('antigo')
    expect(await second.getOrLoad(k, 10, async () => 'novo')).toBe('novo')
    expect(await first.getOrLoad(k, 10, async () => 'inesperado')).toBe('novo')
  })
})
