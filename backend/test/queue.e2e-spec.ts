import { PGlite } from '@electric-sql/pglite'
import { ConfigService } from '@nestjs/config'
import { Queue, Worker } from 'bullmq'
import { drizzle } from 'drizzle-orm/pglite'
import { randomUUID } from 'node:crypto'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { connect, createServer, type AddressInfo, type Socket } from 'node:net'
import { readFile, readdir } from 'node:fs/promises'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import type { Env } from '../src/config/env.ts'
import type { Database } from '../src/db/db.provider.ts'
import { EmailOutboxService } from '../src/email/email-outbox.service.ts'
import type { EmailSender } from '../src/email/email-sender.ts'
import type { EmailPayloadService } from '../src/email/email-payload.service.ts'
import type { NotificacoesWorker } from '../src/notificacoes/notificacoes.worker.ts'
import { QueueOutboxRepository } from '../src/queue/queue-outbox.repository.ts'
import {
  QueueProducer,
  QueueService,
  redisConnection,
} from '../src/queue/queue.service.ts'

const url = process.env.QUEUE_TEST_REDIS_URL
const integration = url ? describe : describe.skip

integration('BullMQ e outbox com Redis real', () => {
  const prefix = `queue-test-${randomUUID()}`
  let pg: PGlite
  let queue: Queue
  let service: QueueService
  let outbox: EmailOutboxService
  let emailId: string
  const enviar = vi.fn(async () => {})
  const config = {
    get: (key: string) => ({ NOTIFICACOES_EMAIL_HABILITADO: 'false' })[key],
  } as ConfigService<Env, true>
  const reconcile = () =>
    (service as unknown as { reconciliar(): Promise<void> }).reconciliar()

  beforeAll(async () => {
    pg = new PGlite()
    for (const dir of (await readdir('drizzle')).sort())
      await pg.exec(await readFile(`drizzle/${dir}/migration.sql`, 'utf8'))
    const db = drizzle({ client: pg }) as unknown as Database
    queue = new Queue('outbox', {
      prefix,
      connection: redisConnection(url!, false),
    })
    queue.on('error', () => {})
    await queue.waitUntilReady()
    outbox = new EmailOutboxService(
      db,
      { enviar } as unknown as EmailSender,
      {
        decifrar: () => ({ para: 'a@example.com', assunto: 'a', texto: 'a' }),
      } as unknown as EmailPayloadService,
      config,
    )
    const producer = new QueueProducer(config)
    ;(producer as unknown as { queue: Queue }).queue = queue
    service = new QueueService(
      producer,
      new QueueOutboxRepository(db),
      config,
      outbox,
      {} as NotificacoesWorker,
    )
    const user = (
      await pg.query<{ id: string }>(
        "INSERT INTO usuarios (nome,email,senha_hash,tipo) VALUES ('A','a@example.com','x','MEDICO') RETURNING id",
      )
    ).rows[0].id
    const token = (
      await pg.query<{ id: string }>(
        "INSERT INTO tokens_recuperacao_senha (usuario_id,token,expires_at) VALUES ($1,'hash',now()+interval '15 minutes') RETURNING id",
        [user],
      )
    ).rows[0].id
    emailId = (
      await pg.query<{ id: string }>(
        "INSERT INTO emails_pendentes (token_id,payload) VALUES ($1,'ciphertext') RETURNING id",
        [token],
      )
    ).rows[0].id
  }, 30000)
  afterAll(async () => {
    await queue?.obliterate({ force: true })
    await queue?.close()
    await pg?.close()
  })

  it('reconcilia apenas IDs, deduplica e configura retentativas', async () => {
    await reconcile()
    await reconcile()
    const jobs = await queue.getJobs(['waiting', 'delayed'])
    expect(jobs).toHaveLength(1)
    expect(jobs[0].name).toBe('email')
    expect(jobs[0].data).toEqual({ id: emailId })
    expect(jobs[0].id).toBe(`email-${emailId}`)
    expect(jobs[0].opts).toMatchObject({
      attempts: 3,
      backoff: { type: 'exponential', delay: 1000 },
    })
  })

  it('republica um job perdido sem perder a outbox', async () => {
    const id = `email-${emailId}`
    await (await queue.getJob(id))!.remove()
    expect(await queue.getJob(id)).toBeUndefined()
    expect(
      (await pg.query('SELECT id FROM emails_pendentes')).rows,
    ).toHaveLength(1)
    await reconcile()
    expect((await queue.getJob(id))?.data).toEqual({ id: emailId })
  })

  it('recupera entrega pendente após falha terminal do job', async () => {
    let attempts = 0
    const worker = new Worker(
      'outbox',
      async () => {
        attempts++
        throw new Error('Infraestrutura temporariamente indisponível')
      },
      { prefix, connection: redisConnection(url!, true) },
    )
    worker.on('error', () => {})
    try {
      await vi.waitFor(() => expect(attempts).toBe(3), { timeout: 10000 })
      await vi.waitFor(
        async () =>
          expect(await queue.getJob(`email-${emailId}`)).toBeUndefined(),
        { timeout: 5000 },
      )
      expect(
        (await pg.query('SELECT id FROM emails_pendentes')).rows,
      ).toHaveLength(1)
    } finally {
      await worker.close()
    }
    await reconcile()
    const republished = await queue.getJob(`email-${emailId}`)
    expect(republished?.attemptsMade).toBe(0)
    expect(republished?.data).toEqual({ id: emailId })
  }, 15000)

  it('duas instâncias entregam uma vez e reentrega após conclusão é noop', async () => {
    const other = new EmailOutboxService(
      (outbox as unknown as { db: Database }).db,
      { enviar } as unknown as EmailSender,
      {
        decifrar: () => ({ para: 'a', assunto: 'a', texto: 'a' }),
      } as unknown as EmailPayloadService,
      config,
    )
    const workers = [outbox, other].map(
      (processor) =>
        new Worker(
          'outbox',
          async (job) => processor.processarId(job.data.id),
          { prefix, connection: redisConnection(url!, true) },
        ),
    )
    try {
      await vi.waitFor(
        async () =>
          expect(
            (await pg.query('SELECT id FROM emails_pendentes')).rows,
          ).toHaveLength(0),
        { timeout: 10000 },
      )
      await outbox.processarId(emailId)
      expect(enviar).toHaveBeenCalledTimes(1)
    } finally {
      await Promise.all(workers.map((worker) => worker.close()))
    }
  }, 15000)
  it('executa retentativas com backoff exponencial no Redis', async () => {
    const producer = new QueueProducer(config)
    ;(producer as unknown as { queue: Queue }).queue = queue
    const id = randomUUID()
    const attempts: number[] = []
    const worker = new Worker(
      'outbox',
      async (job) => {
        if (job.data.id !== id) return
        attempts.push(Date.now())
        if (attempts.length < 3) throw new Error('falha transitória')
      },
      { prefix, connection: redisConnection(url!, true), autorun: false },
    )
    worker.on('error', () => {})
    try {
      await producer.add('email', id)
      void worker.run()
      await vi.waitFor(() => expect(attempts).toHaveLength(3), {
        timeout: 10000,
        interval: 50,
      })
      expect(attempts[1] - attempts[0]).toBeGreaterThanOrEqual(800)
      expect(attempts[2] - attempts[1]).toBeGreaterThanOrEqual(1800)
    } finally {
      await worker.close()
    }
  }, 15000)

  it('lifecycle real rejeita payload inválido e aguarda entrega ativa no shutdown', async () => {
    const values: Record<string, unknown> = {
      NODE_ENV: 'test',
      QUEUE_TEST_ENABLED: 'true',
      QUEUE_REDIS_URL: url,
      QUEUE_PREFIX: prefix,
      QUEUE_CONCURRENCY: 1,
      QUEUE_RECONCILE_MS: 60000,
      NOTIFICACOES_EMAIL_HABILITADO: 'true',
    }
    const lifecycleConfig = {
      get: (key: string) => values[key],
    } as ConfigService<Env, true>
    let release!: () => void
    const blocked = new Promise<void>((resolve) => {
      release = resolve
    })
    const processarId = vi.fn(async () => {
      await blocked
    })
    const repository = {
      listarEmails: vi.fn().mockResolvedValue([]),
      listarNotificacoes: vi.fn().mockResolvedValue([]),
    } as unknown as QueueOutboxRepository
    const producer = {
      add: vi.fn(),
      close: vi.fn().mockResolvedValue(undefined),
    } as unknown as QueueProducer
    const lifecycle = new QueueService(
      producer,
      repository,
      lifecycleConfig,
      { processarId } as unknown as EmailOutboxService,
      { processarId: vi.fn() } as unknown as NotificacoesWorker,
    )
    lifecycle.onModuleInit()
    let closing: Promise<void> | undefined
    try {
      const invalid = await queue.add('email', {}, { attempts: 1 })
      await vi.waitFor(
        async () => expect(await invalid.getState()).toBe('failed'),
        { timeout: 10000 },
      )
      expect(processarId).not.toHaveBeenCalled()
      const id = randomUUID()
      await queue.add('email', { id })
      await vi.waitFor(() => expect(processarId).toHaveBeenCalledWith(id), {
        timeout: 10000,
      })
      let finished = false
      closing = lifecycle.onModuleDestroy().then(() => {
        finished = true
      })
      await new Promise((resolve) => setTimeout(resolve, 100))
      expect(finished).toBe(false)
      release()
      await closing
      expect(finished).toBe(true)
    } finally {
      release()
      await (closing ?? lifecycle.onModuleDestroy())
    }
  }, 20000)
  it('descarta produtor após queda de conexão e reconecta na próxima publicação', async () => {
    const target = new URL(url!)
    const sockets = new Set<Socket>()
    let available = true
    const proxy = createServer((client) => {
      if (!available) {
        client.destroy()
        return
      }
      const upstream = connect(Number(target.port || 6379), target.hostname)
      for (const socket of [client, upstream]) {
        sockets.add(socket)
        socket.on('close', () => sockets.delete(socket))
        socket.on('error', () => {
          client.destroy()
          upstream.destroy()
        })
      }
      client.pipe(upstream).pipe(client)
    })
    await new Promise<void>((resolve) => proxy.listen(0, '127.0.0.1', resolve))
    const proxied = new URL(target)
    proxied.hostname = '127.0.0.1'
    proxied.port = String((proxy.address() as AddressInfo).port)
    const localPrefix = `${prefix}-connection`
    const values: Record<string, unknown> = {
      QUEUE_REDIS_URL: proxied.href,
      QUEUE_PREFIX: localPrefix,
    }
    const producer = new QueueProducer({
      get: (key: string) => values[key],
    } as ConfigService<Env, true>)
    const inspector = new Queue('outbox', {
      prefix: localPrefix,
      connection: redisConnection(url!, false),
    })
    inspector.on('error', () => {})
    try {
      await producer.add('email', randomUUID())
      const native = (producer as unknown as { queue?: Queue }).queue!
      const client = await native.backend.connection.client
      available = false
      for (const socket of sockets) socket.destroy()
      const recoveredId = randomUUID()
      await expect(producer.add('email', recoveredId)).rejects.toThrow()
      expect((producer as unknown as { queue?: Queue }).queue).toBeUndefined()
      expect(client.status).toBe('end')
      available = true
      await producer.add('email', recoveredId)
      expect((await inspector.getJob(`email-${recoveredId}`))?.data).toEqual({
        id: recoveredId,
      })
      // O worker também precisa começar a consumir após uma falha inicial,
      // sem reiniciar a API e sem reaproveitar um handshake rejeitado.
      available = false
      const workerPrefix = `${localPrefix}-worker`
      const settings: Record<string, unknown> = {
        ...values,
        QUEUE_PREFIX: workerPrefix,
        NODE_ENV: 'test',
        QUEUE_TEST_ENABLED: 'true',
        QUEUE_CONCURRENCY: 1,
        QUEUE_RECONCILE_MS: 60000,
        NOTIFICACOES_EMAIL_HABILITADO: 'false',
      }
      const workerConfig = {
        get: (key: string) => settings[key],
      } as ConfigService<Env, true>
      const workerProducer = new QueueProducer(workerConfig)
      const processarId = vi.fn(async () => {})
      const recovering = new QueueService(
        workerProducer,
        {
          listarEmails: async () => [],
        } as unknown as QueueOutboxRepository,
        workerConfig,
        { processarId } as unknown as EmailOutboxService,
        {} as NotificacoesWorker,
      )
      const workerInspector = new Queue('outbox', {
        prefix: workerPrefix,
        connection: redisConnection(url!, false),
      })
      workerInspector.on('error', () => {})
      recovering.onModuleInit()
      try {
        await new Promise((resolve) => setTimeout(resolve, 300))
        available = true
        const id = randomUUID()
        await workerProducer.add('email', id)
        await vi.waitFor(() => expect(processarId).toHaveBeenCalledWith(id), {
          timeout: 8000,
        })
      } finally {
        await recovering.onModuleDestroy()
        await workerInspector.obliterate({ force: true })
        await workerInspector.close()
      }
    } finally {
      await producer.close()
      await inspector.obliterate({ force: true })
      await inspector.close()
      for (const socket of sockets) socket.destroy()
      await new Promise<void>((resolve, reject) =>
        proxy.close((error) => (error ? reject(error) : resolve())),
      )
    }
  }, 15000)

  it('encerra o processo naturalmente após falhas de conexão', async () => {
    const { stdout } = await promisify(execFile)(
      'bun',
      ['test/fixtures/queue-offline.ts'],
      { timeout: 12000 },
    )
    expect(stdout).toContain('shutdown concluído')
  }, 15000)

  it('encerra sem travar durante reconciliação com Redis offline', async () => {
    const values: Record<string, unknown> = {
      NODE_ENV: 'test',
      QUEUE_TEST_ENABLED: 'true',
      QUEUE_REDIS_URL: 'redis://127.0.0.1:1/1',
      QUEUE_PREFIX: prefix,
      QUEUE_CONCURRENCY: 1,
      QUEUE_RECONCILE_MS: 60000,
      NOTIFICACOES_EMAIL_HABILITADO: 'false',
    }
    const cfg = { get: (key: string) => values[key] } as ConfigService<
      Env,
      true
    >
    const repository = {
      listarEmails: vi.fn().mockResolvedValue([{ id: randomUUID() }]),
    } as unknown as QueueOutboxRepository
    const lifecycle = new QueueService(
      new QueueProducer(cfg),
      repository,
      cfg,
      {} as EmailOutboxService,
      {} as NotificacoesWorker,
    )
    lifecycle.onModuleInit()
    const started = Date.now()
    await lifecycle.onModuleDestroy()
    expect(Date.now() - started).toBeLessThan(8000)
  }, 10000)
})

describe('paginação da reconciliação', () => {
  it('alcança itens além dos primeiros 100 mesmo quando continuam pendentes', async () => {
    const pg = new PGlite()
    try {
      for (const dir of (await readdir('drizzle')).sort())
        await pg.exec(await readFile(`drizzle/${dir}/migration.sql`, 'utf8'))
      await pg.exec(`INSERT INTO usuarios (nome,email,senha_hash,tipo) VALUES ('A','cursor@example.com','x','MEDICO');
        INSERT INTO tokens_recuperacao_senha (usuario_id,token,expires_at)
          SELECT id,'cursor',now()+interval '15 minutes' FROM usuarios WHERE email='cursor@example.com';
        INSERT INTO emails_pendentes (token_id,payload)
          SELECT t.id,'ciphertext' FROM tokens_recuperacao_senha t CROSS JOIN generate_series(1,101) WHERE t.token='cursor'`)
      const db = drizzle({ client: pg }) as unknown as Database
      const repository = new QueueOutboxRepository(db)
      const first = await repository.listarEmails()
      const second = await repository.listarEmails(first.at(-1)!.id)
      expect(first).toHaveLength(100)
      expect(second).toHaveLength(1)
      expect(first.map((row) => row.id)).not.toContain(second[0].id)
      const add = vi
        .fn()
        .mockRejectedValueOnce(new Error('Redis offline'))
        .mockResolvedValue(undefined)
      const config = { get: () => 'false' } as unknown as ConfigService<
        Env,
        true
      >
      const service = new QueueService(
        { add } as unknown as QueueProducer,
        repository,
        config,
        {} as EmailOutboxService,
        {} as NotificacoesWorker,
      )
      const reconcile = () =>
        (service as unknown as { reconciliar(): Promise<void> }).reconciliar()
      await expect(reconcile()).rejects.toThrow('Redis offline')
      expect(
        (await pg.query('SELECT id FROM emails_pendentes')).rows,
      ).toHaveLength(101)
      await reconcile()
      await reconcile()
      expect(new Set(add.mock.calls.slice(1).map((call) => call[1])).size).toBe(
        101,
      )
    } finally {
      await pg.close()
    }
  }, 30000)
})
