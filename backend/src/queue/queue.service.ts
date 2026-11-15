import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { Queue, Worker, type ConnectionOptions } from 'bullmq'
import type { Env } from '../config/env.ts'
import { QueueOutboxRepository } from './queue-outbox.repository.ts'
import { EmailOutboxService } from '../email/email-outbox.service.ts'
import { NotificacoesWorker } from '../notificacoes/notificacoes.worker.ts'

export function redisConnection(
  url: string | undefined,
  worker: boolean,
): ConnectionOptions {
  const parsed = new URL(url || 'redis://127.0.0.1:6379')
  const db = parsed.pathname.slice(1)
  return {
    host: parsed.hostname,
    port: Number(parsed.port || 6379),
    ...(parsed.username
      ? { username: decodeURIComponent(parsed.username) }
      : {}),
    ...(parsed.password
      ? { password: decodeURIComponent(parsed.password) }
      : {}),
    ...(db ? { db: Number(db) } : {}),
    ...(parsed.protocol === 'rediss:'
      ? { tls: { servername: parsed.hostname } }
      : {}),
    // O consumer conecta antes de waitUntilReady: uma falha inicial não deve
    // rejeitar para sempre o handshake, pois ele precisa aguardar reconexão.
    lazyConnect: !worker,
    connectTimeout: 1000,
    enableOfflineQueue: true,
    ...(!worker ? { commandTimeout: 1500 } : {}),
    maxRetriesPerRequest: worker ? null : 1,
    retryStrategy: (attempt: number) => Math.min(attempt * 200, 2000),
  }
}

// A producer is created only when enabled and only after the first reconciliation.
// Failed initial connections are discarded so a later tick can reconnect.
@Injectable()
export class QueueProducer {
  private queue?: Queue
  constructor(
    @Inject(ConfigService) private readonly config: ConfigService<Env, true>,
  ) {}

  async add(name: string, id: string) {
    if (!this.queue) {
      const url = this.config.get('QUEUE_REDIS_URL', { infer: true })
      if (!url) return
      const queue = new Queue('outbox', {
        connection: redisConnection(url, false),
        prefix: this.config.get('QUEUE_PREFIX', { infer: true }) ?? 'alocca',
      })
      queue.on('error', () => {})
      try {
        await bounded(queue.waitUntilReady(), 3000)
        this.queue = queue
      } catch (error) {
        await forceClose(queue)
        throw error
      }
    }
    const queue = this.queue
    try {
      await bounded(
        this.queue.add(
          name,
          { id },
          {
            jobId: `${name}-${id}`,
            attempts: 3,
            backoff: { type: 'exponential', delay: 1000 },
            removeOnComplete: true,
            removeOnFail: true,
          },
        ),
        3000,
      )
    } catch (error) {
      if (this.queue === queue) this.queue = undefined
      await forceClose(queue)
      throw error
    }
  }

  async close() {
    if (this.queue)
      await bounded(this.queue.close(), 3000).catch(() =>
        forceClose(this.queue!),
      )
  }
}

// disconnect() do BullMQ aguarda a inicialização. close(true) das conexões
// públicas do backend também encerra clientes que nunca chegaram ao ready.
async function forceClose(instance: Queue | Worker): Promise<void> {
  await Promise.all(
    [instance.backend.connection, instance.backend.blockingConnection]
      .filter((connection) => connection !== undefined)
      .map(async (connection) => {
        const client = connection.client
        // Se um quit gracioso já está pendente, o cliente resolvido permite abortá-lo.
        void client.then((redis) => redis.disconnect()).catch(() => undefined)
        await connection.close(true)
      }),
  )
}

async function bounded<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('Timeout')), ms)
      }),
    ])
  } finally {
    clearTimeout(timer)
  }
}

@Injectable()
export class QueueService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(QueueService.name)
  private timer?: ReturnType<typeof setInterval>
  private worker?: Worker
  private running?: Promise<void>
  private stopping = false
  private emailCursor?: string
  private notificacaoCursor?: string
  private readonly processing = new Set<Promise<void>>()

  constructor(
    @Inject(QueueProducer) private readonly queue: QueueProducer,
    @Inject(QueueOutboxRepository)
    private readonly outbox: QueueOutboxRepository,
    @Inject(ConfigService) private readonly config: ConfigService<Env, true>,
    @Inject(EmailOutboxService) private readonly emails: EmailOutboxService,
    @Inject(NotificacoesWorker)
    private readonly notificacoes: NotificacoesWorker,
  ) {}

  onModuleInit() {
    const url = this.config.get('QUEUE_REDIS_URL', { infer: true })
    if (
      !url ||
      (this.config.get('NODE_ENV', { infer: true }) === 'test' &&
        this.config.get('QUEUE_TEST_ENABLED', { infer: true }) !== 'true')
    )
      return
    this.worker = new Worker(
      'outbox',
      async (job) => {
        if (
          !['email', 'notificacao'].includes(job.name) ||
          !job.data ||
          typeof job.data !== 'object' ||
          Object.keys(job.data).length !== 1 ||
          typeof job.data.id !== 'string' ||
          !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
            job.data.id,
          )
        )
          throw new Error('Job inválido')
        const processing = (async () => {
          if (job.name === 'email') await this.emails.processarId(job.data.id)
          else if (
            job.name === 'notificacao' &&
            this.config.get('NOTIFICACOES_EMAIL_HABILITADO', {
              infer: true,
            }) === 'true'
          )
            await this.notificacoes.processarId(job.data.id)
        })()
        this.processing.add(processing)
        try {
          await processing
        } finally {
          this.processing.delete(processing)
        }
      },
      {
        autorun: false,
        runRetryDelay: 1000,
        connection: redisConnection(url, true),
        prefix: this.config.get('QUEUE_PREFIX', { infer: true }) ?? 'alocca',
        concurrency: this.config.get('QUEUE_CONCURRENCY', { infer: true }),
      },
    )
    this.worker.on('error', () =>
      this.logger.warn('Redis da fila indisponível'),
    )
    const worker = this.worker
    void worker
      .waitUntilReady()
      .then(async () => {
        if (!this.stopping) await worker.run()
      })
      .catch(() => {
        if (!this.stopping)
          this.logger.warn('Worker aguardando disponibilidade do Redis')
      })
    const tick = () => {
      if (this.stopping || this.running) return
      this.running = this.reconciliar()
        .catch(() => this.logger.warn('Reconciliação da fila adiada'))
        .finally(() => {
          this.running = undefined
        })
    }
    tick()
    this.timer = setInterval(
      tick,
      this.config.get('QUEUE_RECONCILE_MS', { infer: true }),
    )
    this.timer.unref()
  }

  private async reconciliar() {
    // Avança mesmo quando os primeiros jobs continuam ativos/delayed no Redis.
    // Ao atingir o fim, reinicia a varredura para recuperar jobs desaparecidos.
    const emails = await this.outbox.listarEmails(this.emailCursor)
    for (const item of emails) {
      if (this.stopping) return
      await this.add('email', item.id)
      this.emailCursor = item.id
    }
    if (emails.length < 100) this.emailCursor = undefined
    if (
      this.config.get('NOTIFICACOES_EMAIL_HABILITADO', { infer: true }) !==
      'true'
    )
      return
    const notificacoes = await this.outbox.listarNotificacoes(
      this.notificacaoCursor,
    )
    for (const item of notificacoes) {
      if (this.stopping) return
      await this.add('notificacao', item.id)
      this.notificacaoCursor = item.id
    }
    if (notificacoes.length < 100) this.notificacaoCursor = undefined
  }

  private async add(name: string, id: string) {
    await this.queue.add(name, id)
  }

  async onModuleDestroy() {
    this.stopping = true
    clearInterval(this.timer)
    if (this.worker) {
      const worker = this.worker
      await bounded(worker.close(), 30000).catch(async () => {
        this.logger.warn('Tempo de desligamento do worker esgotado')
        await bounded(forceClose(worker), 3000).catch(() => undefined)
        await bounded(Promise.allSettled(this.processing), 15000).catch(
          () => undefined,
        )
      })
    }
    if (this.running) await bounded(this.running, 4000).catch(() => undefined)
    await this.queue.close()
  }
}
