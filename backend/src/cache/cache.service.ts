import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { createClient } from 'redis'
import { LRUCache } from 'lru-cache'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import type { Env } from '../config/env.ts'

const entrySchema = z.object({
  generation: z.string().uuid(),
  expiresAt: z.number().finite(),
  value: z.json(),
})
type Entry = z.infer<typeof entrySchema>

// A geração nunca é reutilizada, mesmo após expiração ou reinício do Redis.
const READ = `
local generation = redis.call('GET', KEYS[2])
if not generation then
  generation = ARGV[1]
  redis.call('SET', KEYS[2], generation, 'PX', ARGV[2])
end
if generation == ARGV[3] and redis.call('EXISTS', KEYS[1]) == 1 then
  return {generation, '', 'L1'}
end
return {generation, redis.call('GET', KEYS[1]) or '', 'L2'}
`
const PUBLISH = `
if redis.call('GET', KEYS[2]) ~= ARGV[1] then return false end
local result = redis.call('SET', KEYS[1], ARGV[2], 'PX', ARGV[3], 'NX')
if result then redis.call('PEXPIRE', KEYS[2], ARGV[3]) end
return result
`

/** Redis é a autoridade: L1 só é usada após confirmar a entrada no Redis. */
@Injectable()
export class CacheService implements OnModuleInit, OnModuleDestroy {
  readonly defaultTtlSeconds: number
  private readonly logger = new Logger(CacheService.name)
  private readonly l1 = new LRUCache<string, Entry>({
    max: 1000,
    maxSize: 64 * 1024 * 1024,
    maxEntrySize: 64 * 1024,
    sizeCalculation: (entry) =>
      Buffer.byteLength(JSON.stringify(entry), 'utf8'),
  })
  private readonly client: ReturnType<typeof createClient> | undefined

  constructor(@Inject(ConfigService) config: ConfigService<Env, true>) {
    this.defaultTtlSeconds =
      config.get('CACHE_TTL_SECONDS', { infer: true }) ?? 60
    const url = config.get('REDIS_URL', { infer: true })
    if (url) {
      this.client = createClient({
        url,
        disableOfflineQueue: true,
        socket: { connectTimeout: 1000 },
      })
      this.client.on('error', () => {
        this.l1.clear()
      })
      this.client.on('reconnecting', () => {
        this.l1.clear()
      })
      this.client.on('end', () => {
        this.l1.clear()
      })
    }
  }

  onModuleInit() {
    if (this.client)
      void this.client
        .connect()
        .catch(() => this.logger.warn('Redis indisponível; cache desativado'))
  }

  onModuleDestroy() {
    this.l1.clear()
    if (this.client?.isOpen) this.client.destroy()
  }

  async getOrLoad<T>(
    key: string,
    ttlSeconds: number,
    load: () => Promise<T>,
    decode: (value: unknown) => T = (value) => value as T,
  ): Promise<T> {
    if (
      !Number.isSafeInteger(ttlSeconds) ||
      ttlSeconds < 1 ||
      ttlSeconds > 86400
    )
      throw new RangeError('TTL do cache deve estar entre 1 e 86400 segundos')
    const client = this.client
    if (!client?.isReady) return load()
    const dataKey = `alocca:cache:data:${key}`
    const versionKey = `alocca:cache:version:${key}`
    let generation: string
    const local = this.l1.get(key)
    try {
      const result = (await client
        .withAbortSignal(AbortSignal.timeout(200))
        .eval(READ, {
          keys: [dataKey, versionKey],
          arguments: [
            randomUUID(),
            String(ttlSeconds * 1000),
            local?.generation ?? '',
          ],
        })) as [string, string, string]
      generation = result[0]
      const entry =
        result[2] === 'L1'
          ? local
          : result[1]
            ? entrySchema.parse(JSON.parse(result[1]))
            : undefined
      if (
        entry &&
        entry.generation === generation &&
        entry.expiresAt > Date.now()
      ) {
        this.remember(key, entry)
        return decode(structuredClone(entry.value))
      }
      this.l1.delete(key)
    } catch {
      this.l1.clear()
      return load()
    }

    const value = await load()
    try {
      // JSON é o contrato do cache. Serialização inválida nunca quebra a leitura.
      const raw = JSON.stringify({
        generation,
        expiresAt: Date.now() + ttlSeconds * 1000,
        value,
      })
      // Limita também o tamanho por entrada: até ~64 MiB de payload na L1.
      if (Buffer.byteLength(raw, 'utf8') > 64 * 1024) return value
      const entry = entrySchema.parse(JSON.parse(raw))
      decode(entry.value)
      const published = await client
        .withAbortSignal(AbortSignal.timeout(200))
        .eval(PUBLISH, {
          keys: [dataKey, versionKey],
          arguments: [generation, raw, String(ttlSeconds * 1000)],
        })
      if (published) this.remember(key, entry)
    } catch {
      this.l1.clear()
    }
    return value
  }

  /**
   * Invalidação administrativa. Para escritas de negócio, use chaves com revisão
   * da fonte de verdade: um erro Redis após commit não pode desfazer a escrita.
   */
  async invalidate(key: string): Promise<void> {
    this.l1.delete(key)
    if (!this.client?.isReady)
      throw new Error('Redis indisponível para invalidar cache')
    try {
      await this.client
        .withAbortSignal(AbortSignal.timeout(200))
        .eval("return redis.call('DEL', KEYS[1], KEYS[2])", {
          keys: [`alocca:cache:data:${key}`, `alocca:cache:version:${key}`],
          arguments: [],
        })
    } catch (error) {
      this.l1.clear()
      throw error
    }
  }

  private remember(key: string, entry: Entry) {
    // Usa o prazo original: hits locais não renovam o TTL da entrada.
    const ttl = entry.expiresAt - Date.now()
    if (ttl <= 0) {
      this.l1.delete(key)
      return
    }
    this.l1.set(key, entry, { ttl })
  }
}
