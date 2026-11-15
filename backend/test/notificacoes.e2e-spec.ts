import { PGlite } from '@electric-sql/pglite'
import { Test } from '@nestjs/testing'
import { JwtService } from '@nestjs/jwt'
import type { INestApplication } from '@nestjs/common'
import { drizzle } from 'drizzle-orm/pglite'
import { readdir, readFile } from 'node:fs/promises'
import request from 'supertest'
import { vi } from 'vitest'
import { AppModule } from '../src/app.module.ts'
import { DRIZZLE_DB } from '../src/db/db.provider.ts'
import { EmailSender } from '../src/email/email-sender.ts'
import { NotificacoesWorker } from '../src/notificacoes/notificacoes.worker.ts'
import { ConfigService } from '@nestjs/config'
import { AlocacaoRepository } from '../src/candidaturas/alocacao.repository.ts'
import type { Database } from '../src/db/db.provider.ts'

describe('notificações', () => {
  let db: PGlite
  let app: INestApplication
  let medico: string,
    gestor: string,
    notificacao: string,
    tokenMedico: string,
    tokenGestor: string
  const enviar = vi.fn()
  beforeAll(async () => {
    process.env.SMTP_HOST = 'smtp.invalid'
    process.env.SMTP_USER = 'test'
    process.env.SMTP_PASS = 'test'
    db = new PGlite()
    for (const dir of (await readdir('drizzle')).sort())
      await db.exec(await readFile(`drizzle/${dir}/migration.sql`, 'utf8'))
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(DRIZZLE_DB)
      .useValue(drizzle({ client: db }))
      .overrideProvider(EmailSender)
      .useValue({ enviar })
      .compile()
    app = module.createNestApplication()
    await app.init()
    const users = (
      await db.query<{ id: string; tipo: string }>(
        `INSERT INTO usuarios (nome,email,senha_hash,tipo) VALUES ('M','m@example.com','x','MEDICO'),('G','g@example.com','x','GESTOR') RETURNING id,tipo`,
      )
    ).rows
    medico = users.find((u) => u.tipo === 'MEDICO')!.id
    gestor = users.find((u) => u.tipo === 'GESTOR')!.id
    const instituicao = (
      await db.query<{ id: string }>(
        `INSERT INTO instituicoes (usuario_id,nome,cnpj,cidade,uf) VALUES ($1,'H','11111111000111','Brasília','DF') RETURNING id`,
        [gestor],
      )
    ).rows[0].id
    const plantao = (
      await db.query<{ id: string }>(
        `INSERT INTO plantoes (instituicao_id,gestor_criador_id,titulo,local_unidade,especialidade,data_inicio,data_fim,valor,quantidade_vagas,vagas_disponiveis) VALUES ($1,$2,'P','H','Clínica',now(),now()+interval '1 day',100,1,1) RETURNING id`,
        [instituicao, gestor],
      )
    ).rows[0].id
    notificacao = (
      await db.query<{ id: string }>(
        `INSERT INTO notificacoes (usuario_destino_id,plantao_id,tipo) VALUES ($1,$2,'ALOCACAO_APROVADA') RETURNING id`,
        [medico, plantao],
      )
    ).rows[0].id
    const jwt = app.get(JwtService)
    tokenMedico = `Bearer ${await jwt.signAsync({ sub: medico })}`
    tokenGestor = `Bearer ${await jwt.signAsync({ sub: gestor })}`
  }, 30000)
  afterAll(async () => {
    await app?.close()
    await db?.close()
    delete process.env.SMTP_HOST
    delete process.env.SMTP_USER
    delete process.env.SMTP_PASS
  })
  it('isola destinatários, valida entrada e mantém leitura idempotente', async () => {
    await request(app.getHttpServer()).get('/notificacoes').expect(401)
    await request(app.getHttpServer())
      .get('/notificacoes?pagina=0')
      .set('Authorization', tokenMedico)
      .expect(400)
    await request(app.getHttpServer())
      .patch(`/notificacoes/${notificacao}/lida`)
      .set('Authorization', tokenGestor)
      .expect(404)
    const lista = await request(app.getHttpServer())
      .get('/notificacoes?pagina=1&limite=20')
      .set('Authorization', tokenMedico)
      .expect(200)
    expect(lista.body).toMatchObject({
      pagina: 1,
      limite: 20,
      total: 1,
      dados: [{ id: notificacao, lida_em: null, tipo: 'ALOCACAO_APROVADA' }],
    })
    expect(lista.body.dados[0].mensagem).toContain('P — H, H,')
    const primeira = await request(app.getHttpServer())
      .patch(`/notificacoes/${notificacao}/lida`)
      .set('Authorization', tokenMedico)
      .expect(200)
    const segunda = await request(app.getHttpServer())
      .patch(`/notificacoes/${notificacao}/lida`)
      .set('Authorization', tokenMedico)
      .expect(200)
    expect(primeira.body.mensagem).toBe(lista.body.dados[0].mensagem)
    expect(primeira.body.lida_em).toBeTruthy()
    expect(segunda.body.lida_em).toBe(primeira.body.lida_em)
    await request(app.getHttpServer())
      .get('/notificacoes')
      .set('Authorization', tokenGestor)
      .expect(200)
      .expect(({ body }) => expect(body.total).toBe(0))
    await request(app.getHttpServer())
      .put('/notificacoes/preferencias')
      .set('Authorization', tokenMedico)
      .send({ email_habilitado: 'true' })
      .expect(400)
    await request(app.getHttpServer())
      .put('/notificacoes/preferencias')
      .set('Authorization', tokenMedico)
      .send({ email_habilitado: true })
      .expect(200)
      .expect({ email_habilitado: true })
    await request(app.getHttpServer())
      .get('/notificacoes/preferencias')
      .set('Authorization', tokenGestor)
      .expect(200)
      .expect({ email_habilitado: false })
  })
  it('reagenda falha e não reenvia após sucesso', async () => {
    enviar
      .mockRejectedValueOnce(new Error('SMTP indisponível'))
      .mockResolvedValue(undefined)
    const worker = app.get(NotificacoesWorker)
    await db.query('UPDATE notificacoes SET email_elegivel=true WHERE id=$1', [
      notificacao,
    ])
    await worker.processar()
    let row = (
      await db.query<{ status: string; tentativas: number }>(
        `SELECT status,tentativas FROM notificacoes WHERE id=$1`,
        [notificacao],
      )
    ).rows[0]
    expect(row).toEqual({ status: 'PENDENTE', tentativas: 1 })
    await worker.processar()
    expect(enviar).toHaveBeenCalledTimes(1)
    await db.query(`UPDATE notificacoes SET disponivel_em=now() WHERE id=$1`, [
      notificacao,
    ])
    await Promise.all([worker.processar(), worker.processar()])
    await worker.processar()
    row = (
      await db.query<{ status: string; tentativas: number }>(
        `SELECT status,tentativas FROM notificacoes WHERE id=$1`,
        [notificacao],
      )
    ).rows[0]
    expect(row).toEqual({ status: 'ENVIADA', tentativas: 2 })
    expect(enviar).toHaveBeenCalledTimes(2)
  })
  it('mantém o limite temporal ao receber eventos entre páginas', async () => {
    const primeira = await request(app.getHttpServer())
      .get('/notificacoes?limite=1')
      .set('Authorization', tokenMedico)
      .expect(200)
    await db.query(
      `INSERT INTO notificacoes (usuario_destino_id,plantao_id,tipo,created_at) SELECT usuario_destino_id,plantao_id,tipo,$2::timestamp + interval '1 second' FROM notificacoes WHERE id=$1`,
      [notificacao, primeira.body.ate],
    )
    const segunda = await request(app.getHttpServer())
      .get(
        `/notificacoes?pagina=2&limite=1&ate=${encodeURIComponent(primeira.body.ate)}`,
      )
      .set('Authorization', tokenMedico)
      .expect(200)
    expect(segunda.body.total).toBe(1)
    expect(segunda.body.dados).toEqual([])
    await db.query(`DELETE FROM notificacoes WHERE id<>$1`, [notificacao])
  })
  it('não entrega sem consentimento, para excluído ou sem SMTP', async () => {
    enviar.mockClear()
    await db.query(
      `UPDATE notificacoes SET status='PENDENTE', disponivel_em=now(), tentativas=0, email_elegivel=true WHERE id=$1`,
      [notificacao],
    )
    await db.query(
      `UPDATE usuarios SET email_notificacoes_habilitado=false WHERE id=$1`,
      [medico],
    )
    const worker = app.get(NotificacoesWorker)
    await worker.processar()
    expect(enviar).not.toHaveBeenCalled()
    await db.query(
      `UPDATE usuarios SET email_notificacoes_habilitado=true, deleted_at=now() WHERE id=$1`,
      [medico],
    )
    await worker.processar()
    expect(enviar).not.toHaveBeenCalled()
    await db.query(`UPDATE usuarios SET deleted_at=null WHERE id=$1`, [medico])
    const config = app.get(ConfigService)
    const get = config.get.bind(config)
    const spy = vi
      .spyOn(config, 'get')
      .mockImplementation((key: string, options?: never) =>
        key === 'SMTP_HOST' ? undefined : get(key, options),
      )
    try {
      await worker.processar()
      expect(enviar).not.toHaveBeenCalled()
      const row = (
        await db.query<{ status: string; tentativas: number }>(
          `SELECT status,tentativas FROM notificacoes WHERE id=$1`,
          [notificacao],
        )
      ).rows[0]
      expect(row).toEqual({ status: 'PENDENTE', tentativas: 1 })
    } finally {
      spy.mockRestore()
    }
  })
  it('registra elegibilidade no fato e não envia histórico após opt-in ou ativação global', async () => {
    const database = app.get<Database>(DRIZZLE_DB)
    const config = app.get(ConfigService)
    const get = config.get.bind(config)
    let global = false
    const spy = vi
      .spyOn(config, 'get')
      .mockImplementation((key: string, options?: never) =>
        key === 'NOTIFICACOES_EMAIL_HABILITADO'
          ? global
            ? 'true'
            : 'false'
          : get(key, options),
      )
    try {
      await db.query(
        'UPDATE usuarios SET email_notificacoes_habilitado=false WHERE id=$1',
        [medico],
      )
      const plantao = (
        await db.query<{ plantao_id: string }>(
          'SELECT plantao_id FROM notificacoes WHERE id=$1',
          [notificacao],
        )
      ).rows[0].plantao_id
      const repo = app.get(AlocacaoRepository)
      async function criar() {
        return database.transaction((tx) =>
          repo.notificar(tx, [
            {
              usuario_destino_id: medico,
              plantao_id: plantao,
              tipo: 'PLANTAO_CANCELADO',
            },
          ]),
        )
      }
      await criar()
      global = true
      await criar()
      await request(app.getHttpServer())
        .put('/notificacoes/preferencias')
        .set('Authorization', tokenMedico)
        .send({ email_habilitado: true })
        .expect(200)
      await criar()
      const rows = await db.query<{ email_elegivel: boolean }>(
        "SELECT email_elegivel FROM notificacoes WHERE tipo='PLANTAO_CANCELADO' ORDER BY created_at, id",
      )
      expect(rows.rows.filter((r) => r.email_elegivel)).toHaveLength(1)
      await request(app.getHttpServer())
        .put('/notificacoes/preferencias')
        .set('Authorization', tokenMedico)
        .send({ email_habilitado: false })
        .expect(200)
      await request(app.getHttpServer())
        .put('/notificacoes/preferencias')
        .set('Authorization', tokenMedico)
        .send({ email_habilitado: true })
        .expect(200)
      const remaining = await db.query(
        "SELECT id FROM notificacoes WHERE tipo='PLANTAO_CANCELADO' AND email_elegivel",
      )
      expect(remaining.rows).toHaveLength(0)
    } finally {
      spy.mockRestore()
    }
  })
  it('limita tentativas e libera a transação durante o envio', async () => {
    await db.query(
      "UPDATE notificacoes SET status='PENDENTE', email_elegivel=true, tentativas=4, disponivel_em=now(), entrega_token=null, entrega_ate=null WHERE id=$1",
      [notificacao],
    )
    let liberar!: () => void
    let iniciado!: () => void
    const comecou = new Promise<void>((resolve) => {
      iniciado = resolve
    })
    enviar.mockImplementationOnce(
      () =>
        new Promise((_resolve, reject) => {
          liberar = () => reject(new Error('falha'))
          iniciado()
        }),
    )
    const trabalho = app.get(NotificacoesWorker).processar()
    await comecou
    await db.query(
      'UPDATE notificacoes SET lida_em=coalesce(lida_em, now()) WHERE id=$1',
      [notificacao],
    )
    liberar()
    await trabalho
    const row = (
      await db.query<{ tentativas: number; email_elegivel: boolean }>(
        'SELECT tentativas,email_elegivel FROM notificacoes WHERE id=$1',
        [notificacao],
      )
    ).rows[0]
    expect(row).toEqual({ tentativas: 5, email_elegivel: false })
  })
})
