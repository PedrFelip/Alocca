import {
  Inject,
  Injectable,
  Logger,
  type OnModuleInit,
  type OnModuleDestroy,
} from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { eq, lte, sql } from 'drizzle-orm'
import type { Env } from '../config/env.ts'
import { DRIZZLE_DB, type Database } from '../db/db.provider.ts'
import {
  emailsPendentesTable,
  tokensRecuperacaoSenhaTable,
} from '../db/schemas/index.ts'
import { EmailSender } from './email-sender.ts'
import { EmailPayloadService } from './email-payload.service.ts'

/** Cada lote mantém lock SKIP LOCKED durante o envio: múltiplas instâncias são seguras.
 * Entrega pelo menos uma vez: falha após aceitação SMTP pode repetir o mesmo código.
 */
@Injectable()
export class EmailOutboxService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(EmailOutboxService.name)
  private timer?: ReturnType<typeof setInterval>
  private executando?: Promise<void>
  constructor(
    @Inject(DRIZZLE_DB) private readonly db: Database,
    @Inject(EmailSender) private readonly email: EmailSender,
    @Inject(EmailPayloadService) private readonly payloads: EmailPayloadService,
    @Inject(ConfigService) private readonly config: ConfigService<Env, true>,
  ) {}

  onModuleInit() {
    if (this.config.get('NODE_ENV', { infer: true }) === 'test') return
    this.timer = setInterval(() => {
      void this.processar().catch(() =>
        this.logger.error('Falha ao processar fila de e-mail'),
      )
    }, 1000)
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
    // Uma mensagem por transação limita a duração das travas ao timeout SMTP.
    for (let i = 0; i < 10; i++) {
      const encontrou = await this.db.transaction(async (tx) => {
        const [job] = await tx
          .select({
            id: emailsPendentesTable.id,
            payload: emailsPendentesTable.payload,
            used_at: tokensRecuperacaoSenhaTable.used_at,
            expirado: sql<boolean>`${tokensRecuperacaoSenhaTable.expires_at} <= now()`,
          })
          .from(emailsPendentesTable)
          .innerJoin(
            tokensRecuperacaoSenhaTable,
            eq(emailsPendentesTable.token_id, tokensRecuperacaoSenhaTable.id),
          )
          .where(lte(emailsPendentesTable.disponivel_em, sql`now()`))
          .orderBy(emailsPendentesTable.disponivel_em)
          .for('update', { of: emailsPendentesTable, skipLocked: true })
          .limit(1)
        if (!job) return false
        if (job.used_at || job.expirado) {
          await tx
            .delete(emailsPendentesTable)
            .where(eq(emailsPendentesTable.id, job.id))
          return true
        }
        try {
          await this.email.enviar(this.payloads.decifrar(job.payload))
          await tx
            .delete(emailsPendentesTable)
            .where(eq(emailsPendentesTable.id, job.id))
        } catch {
          // Nunca registrar conteúdo SMTP: pode conter o código de recuperação.
          this.logger.warn('Entrega de e-mail adiada para nova tentativa')
          await tx
            .update(emailsPendentesTable)
            .set({
              tentativas: sql`${emailsPendentesTable.tentativas} + 1`,
              disponivel_em: sql`now() + interval '30 seconds'`,
            })
            .where(eq(emailsPendentesTable.id, job.id))
        }
        return true
      })
      if (!encontrou) break
    }
  }
}
