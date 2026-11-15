import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { and, eq, isNull, lte, sql } from 'drizzle-orm'
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
    for (let i = 0; i < 10; i++) {
      const encontrou = await this.db.transaction(async (tx) => {
        const [job] = await tx
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
              lte(notificacoesTable.disponivel_em, sql`now()`),
              eq(usuariosTable.email_notificacoes_habilitado, true),
              eq(usuariosTable.status, 'ATIVO'),
              isNull(usuariosTable.deleted_at),
            ),
          )
          .orderBy(notificacoesTable.created_at, notificacoesTable.id)
          .for('update', { of: notificacoesTable, skipLocked: true })
          .limit(1)
        if (!job) return false
        const conteudo = apresentar(job.notificacao, job.plantao)
        try {
          if (!this.config.get('SMTP_HOST', { infer: true }))
            throw new Error('SMTP não configurado')
          await this.email.enviar({
            para: job.email,
            assunto: conteudo.titulo,
            texto: conteudo.mensagem,
          })
          await tx
            .update(notificacoesTable)
            .set({ status: 'ENVIADA', enviada_at: sql`now()` })
            .where(eq(notificacoesTable.id, job.notificacao.id))
        } catch {
          this.logger.warn('Entrega de notificação adiada')
          await tx
            .update(notificacoesTable)
            .set({
              tentativas: sql`${notificacoesTable.tentativas} + 1`,
              disponivel_em: sql`now() + least(3600, 30 * power(2, least(${notificacoesTable.tentativas}, 7))) * interval '1 second'`,
            })
            .where(eq(notificacoesTable.id, job.notificacao.id))
        }
        return true
      })
      if (!encontrou) break
    }
  }
}
