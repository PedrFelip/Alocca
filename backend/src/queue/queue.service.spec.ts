import { describe, expect, it, vi } from 'vitest'
import {
  QueueService,
  QueueProducer,
  redisConnection,
} from './queue.service.ts'
import type { QueueOutboxRepository } from './queue-outbox.repository.ts'
import type { ConfigService } from '@nestjs/config'
import type { Env } from '../config/env.ts'
import type { EmailOutboxService } from '../email/email-outbox.service.ts'
import type { NotificacoesWorker } from '../notificacoes/notificacoes.worker.ts'

function service(values: Record<string, unknown>, queue = { close: vi.fn() }) {
  const config = { get: (key: string) => values[key] }
  return new QueueService(
    queue as unknown as QueueProducer,
    {} as QueueOutboxRepository,
    config as ConfigService<Env, true>,
    {} as EmailOutboxService,
    {} as NotificacoesWorker,
  )
}

describe('conexão da fila', () => {
  it('interpreta banco, credenciais escapadas e TLS', () => {
    expect(
      redisConnection('rediss://user%40x:p%3Ass@redis.example:6380/1', false),
    ).toMatchObject({
      host: 'redis.example',
      port: 6380,
      username: 'user@x',
      password: 'p:ss',
      db: 1,
      tls: { servername: 'redis.example' },
      lazyConnect: true,
    })
    expect(redisConnection('redis://localhost/0', true)).toMatchObject({
      host: 'localhost',
      port: 6379,
      db: 0,
      maxRetriesPerRequest: null,
    })
    expect(redisConnection('redis://localhost/0', true)).toHaveProperty(
      'lazyConnect',
      false,
    )
    expect(redisConnection('redis://localhost/0', true)).not.toHaveProperty(
      'commandTimeout',
    )
    expect(redisConnection('redis://localhost/0', false)).toHaveProperty(
      'commandTimeout',
      1500,
    )
  })

  it.each([
    { NODE_ENV: 'production' },
    {
      NODE_ENV: 'test',
      QUEUE_REDIS_URL: 'redis://127.0.0.1:1/1',
      QUEUE_TEST_ENABLED: 'false',
    },
  ])('não inicia fila desabilitada ou teste sem opt-in: %o', async (values) => {
    const queue = { close: vi.fn() }
    const instance = service(values, queue)
    instance.onModuleInit()
    await instance.onModuleDestroy()
    expect(queue.close).toHaveBeenCalledOnce()
  })
})

describe('IDs da outbox', () => {
  it.each([undefined, null, '', 'inválido'])(
    'rejeita ID %s sem executar lote',
    async (id) => {
      const db = { transaction: vi.fn(), update: vi.fn() }
      const { EmailOutboxService } =
        await import('../email/email-outbox.service.ts')
      const { NotificacoesWorker } =
        await import('../notificacoes/notificacoes.worker.ts')
      const email = new EmailOutboxService(
        db as never,
        {} as never,
        {} as never,
        {} as never,
      )
      const notificacao = new NotificacoesWorker(
        db as never,
        {} as never,
        {} as never,
      )
      await expect(email.processarId(id as string)).rejects.toThrow()
      await expect(notificacao.processarId(id as string)).rejects.toThrow()
      expect(db.transaction).not.toHaveBeenCalled()
      expect(db.update).not.toHaveBeenCalled()
    },
  )
})
