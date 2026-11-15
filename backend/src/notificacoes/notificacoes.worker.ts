import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { and, eq, isNull, lte, lt, or, sql } from 'drizzle-orm'
import { randomUUID } from 'node:crypto'
import type { Env } from '../config/env.ts'
import { DRIZZLE_DB, type Database } from '../db/db.provider.ts'
import {
  notificacoesTable,
  usuariosTable,
  plantoesTable,
  instituicoesTable,
} from '../db/schemas/index.ts'
import { EmailSender } from '../email/email-sender.ts'
import { apresentar } from './notificacoes.service.ts'

@Injectable()
export class NotificacoesWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(NotificacoesWorker.name)
  private timer?: ReturnType<typeof setInterval>
  private executando?: Promise<void>
  constructor(
    @Inject(DRIZZLE_DB) private readonly db: Database,
    @Inject(EmailSender) private readonly email: EmailSender,
    @Inject(ConfigService) private readonly config: ConfigService<Env, true>,
  ) {}
  onModuleInit() {
    if (
      this.config.get('NODE_ENV', { infer: true }) === 'test' ||
      this.config.get('NOTIFICACOES_EMAIL_HABILITADO', { infer: true }) !==
        'true'
    )
      return
    this.timer = setInterval(() => {
      void this.processar().catch(() =>
        this.logger.error('Falha ao processar notificações'),
      )
    }, 30000)
    this.timer.unref()
  }
  async onModuleDestroy() {
    clearInterval(this.timer)
    await this.executando
  }
  processar(): Promise<void> {
    if (this.executando) return this.executando
    this.executando = this.lote().finally(() => {
      this.executando = undefined
    })
    return this.executando
  }
  private async lote() {
    // Uma tentativa interrompida também conta; libera eventos cuja última reserva expirou.
    await this.db
      .update(notificacoesTable)
      .set({ email_elegivel: false, entrega_token: null, entrega_ate: null })
      .where(
        and(
          eq(notificacoesTable.email_elegivel, true),
          eq(notificacoesTable.status, 'PENDENTE'),
          sql`${notificacoesTable.tentativas} >= 5`,
          or(
            isNull(notificacoesTable.entrega_ate),
            lte(notificacoesTable.entrega_ate, sql`now()`),
          ),
        ),
      )
    for (let i = 0; i < 10; i++) {
      const token = randomUUID()
      const job = await this.db.transaction(async (tx) => {
        const [item] = await tx
          .select({
            notificacao: notificacoesTable,
            email: usuariosTable.email,
            plantao: {
              titulo: plantoesTable.titulo,
              unidade: plantoesTable.local_unidade,
              instituicao: instituicoesTable.nome,
              inicio: plantoesTable.data_inicio,
            },
          })
          .from(notificacoesTable)
          .innerJoin(
            usuariosTable,
            eq(usuariosTable.id, notificacoesTable.usuario_destino_id),
          )
          .innerJoin(
            plantoesTable,
            eq(plantoesTable.id, notificacoesTable.plantao_id),
          )
          .innerJoin(
            instituicoesTable,
            eq(instituicoesTable.id, plantoesTable.instituicao_id),
          )
          .where(
            and(
              eq(notificacoesTable.status, 'PENDENTE'),
              eq(notificacoesTable.email_elegivel, true),
              lt(notificacoesTable.tentativas, 5),
              lte(notificacoesTable.disponivel_em, sql`now()`),
              or(
                isNull(notificacoesTable.entrega_ate),
                lte(notificacoesTable.entrega_ate, sql`now()`),
              ),
              eq(usuariosTable.email_notificacoes_habilitado, true),
              eq(usuariosTable.status, 'ATIVO'),
              isNull(usuariosTable.deleted_at),
            ),
          )
          .orderBy(notificacoesTable.created_at, notificacoesTable.id)
          .for('update', { of: notificacoesTable, skipLocked: true })
          .limit(1)
        if (!item) return null
        await tx
          .update(notificacoesTable)
          .set({
            entrega_token: token,
            entrega_ate: sql`now() + interval '2 minutes'`,
            tentativas: sql`${notificacoesTable.tentativas} + 1`,
          })
          .where(eq(notificacoesTable.id, item.notificacao.id))
        return item
      })
      if (!job) break
      const id = job.notificacao.id
      const ownership = and(
        eq(notificacoesTable.id, id),
        eq(notificacoesTable.entrega_token, token),
      )
      try {
        const [eligible] = await this.db
          .select({ id: notificacoesTable.id })
          .from(notificacoesTable)
          .innerJoin(
            usuariosTable,
            eq(usuariosTable.id, notificacoesTable.usuario_destino_id),
          )
          .where(
            and(
              ownership,
              eq(notificacoesTable.email_elegivel, true),
              eq(usuariosTable.email_notificacoes_habilitado, true),
              eq(usuariosTable.status, 'ATIVO'),
              isNull(usuariosTable.deleted_at),
            ),
          )
        if (!eligible) continue
        if (!this.config.get('SMTP_HOST', { infer: true }))
          throw new Error('SMTP não configurado')
        const conteudo = apresentar(job.notificacao, job.plantao)
        await this.email.enviar({
          para: job.email,
          assunto: conteudo.titulo,
          texto: conteudo.mensagem,
        })
        await this.db
          .update(notificacoesTable)
          .set({
            status: 'ENVIADA',
            enviada_at: sql`now()`,
            email_elegivel: false,
            entrega_token: null,
            entrega_ate: null,
          })
          .where(ownership)
      } catch {
        this.logger.warn('Falha na entrega de notificação')
        await this.db
          .update(notificacoesTable)
          .set({
            email_elegivel: sql`${notificacoesTable.email_elegivel} and ${job.notificacao.tentativas + 1 < 5}`,
            entrega_token: null,
            entrega_ate: null,
            disponivel_em: sql`now() + least(3600, 30 * power(2, least(${notificacoesTable.tentativas} - 1, 7))) * interval '1 second'`,
          })
          .where(ownership)
      }
    }
  }
}
