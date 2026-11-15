import type { ConfigService } from '@nestjs/config'
import type { Env } from '../../src/config/env.ts'
import type { EmailOutboxService } from '../../src/email/email-outbox.service.ts'
import type { NotificacoesWorker } from '../../src/notificacoes/notificacoes.worker.ts'
import type { QueueOutboxRepository } from '../../src/queue/queue-outbox.repository.ts'
import { QueueProducer, QueueService } from '../../src/queue/queue.service.ts'

const values: Record<string, unknown> = {
  NODE_ENV: 'test',
  QUEUE_TEST_ENABLED: 'true',
  QUEUE_REDIS_URL: 'redis://127.0.0.1:1/1',
  QUEUE_PREFIX: 'offline-regression',
  QUEUE_CONCURRENCY: 1,
  QUEUE_RECONCILE_MS: 60000,
  NOTIFICACOES_EMAIL_HABILITADO: 'false',
}
const config = { get: (key: string) => values[key] } as ConfigService<Env, true>
const producer = new QueueProducer(config)
for (let index = 0; index < 2; index++) {
  try {
    await producer.add('email', '00000000-0000-4000-8000-000000000001')
  } catch {
    /* Redis offline é deliberado. */
  }
}
await producer.close()
const service = new QueueService(
  new QueueProducer(config),
  {
    listarEmails: async () => [],
  } as unknown as QueueOutboxRepository,
  config,
  {} as EmailOutboxService,
  {} as NotificacoesWorker,
)
service.onModuleInit()
await new Promise((resolve) => setTimeout(resolve, 200))
await service.onModuleDestroy()
console.log('shutdown concluído')
// Não force process.exit(): conexões/timers vazados devem fazer o teste falhar.
