import { Inject, Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { createTransport, type Transporter } from 'nodemailer'
import type { Env } from '../config/env.ts'

export type Email = { para: string; assunto: string; texto: string }

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name)
  private readonly transporter: Transporter | null
  private readonly remetente: string

  constructor(@Inject(ConfigService) config: ConfigService<Env, true>) {
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
      return
    }
    await this.transporter.sendMail({
      from: this.remetente,
      to: email.para,
      subject: email.assunto,
      text: email.texto,
    })
  }
}
