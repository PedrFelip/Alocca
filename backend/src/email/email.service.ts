import { EmailSender, type Email } from './email-sender.ts'
export type { Email } from './email-sender.ts'
import { Inject, Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { createTransport, type Transporter } from 'nodemailer'
import type { Env } from '../config/env.ts'

@Injectable()
export class EmailService extends EmailSender {
  private readonly logger = new Logger(EmailService.name)
  private readonly transporter: Transporter | null
  private readonly remetente: string

  constructor(@Inject(ConfigService) config: ConfigService<Env, true>) {
    super()
    const host = config.get('SMTP_HOST', { infer: true })
    const port = config.get('SMTP_PORT', { infer: true })
    const user = config.get('SMTP_USER', { infer: true })
    const pass = config.get('SMTP_PASS', { infer: true })
    this.remetente =
      config.get('SMTP_FROM', { infer: true }) ??
      user ??
      'nao-responda@alocca.local'
    this.transporter = host
      ? createTransport({
          host,
          connectionTimeout: 5000,
          greetingTimeout: 5000,
          socketTimeout: 10000,
          port,
          // 465 = tls direto (gmail)
          secure: port === 465,
          auth: user && pass ? { user, pass } : undefined,
        })
      : null
  }

  async enviar(email: Email): Promise<void> {
    if (!this.transporter) {
      // nao loga o conteudo, tem o codigo
      this.logger.warn('SMTP_HOST não configurado, e-mail não enviado')
      throw new Error('SMTP indisponível')
    }
    await this.transporter.sendMail({
      from: this.remetente,
      to: email.para,
      subject: email.assunto,
      text: email.texto,
    })
  }
}
