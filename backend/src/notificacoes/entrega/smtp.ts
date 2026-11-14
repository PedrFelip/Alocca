import { createTransport, type Transporter } from 'nodemailer'
import type { Env } from '../../config/env.ts'
import { FalhaEntrega, type CanalEntrega, type Mensagem } from './contrato.ts'

export class CanalSmtp implements CanalEntrega {
  private readonly transporte: Transporter | null
  constructor(private readonly env: Env) {
    this.transporte = env.SMTP_HOST
      ? createTransport({
          host: env.SMTP_HOST,
          port: env.SMTP_PORT,
          secure: env.SMTP_PORT === 465,
          auth: env.SMTP_USER
            ? { user: env.SMTP_USER, pass: env.SMTP_PASS }
            : undefined,
          pool: true,
          maxConnections: env.NOTIFICATIONS_CONCURRENCY,
          maxMessages: 100,
          connectionTimeout: 10_000,
          greetingTimeout: 10_000,
          socketTimeout: 15_000,
        })
      : null
  }
  async enviar(m: Mensagem) {
    if (!this.transporte || !this.env.SMTP_FROM)
      throw new FalhaEntrega('SMTP_NAO_CONFIGURADO', false, 0, true)
    try {
      const info = await this.transporte.sendMail({
        from: this.env.SMTP_FROM,
        to: m.destino,
        messageId: `<${m.notificacaoId}@notifications.alocca>`,
        subject: 'Atualização no Alocca',
        text: `Você tem uma atualização sobre um plantão. Abra o Alocca para consultar os detalhes. Referência: ${m.notificacaoId}`,
      })
      if (!info.accepted?.length) throw new FalhaEntrega('SMTP_NAO_ACEITO')
    } catch (err) {
      if (err instanceof FalhaEntrega) throw err
      const code = (err as { responseCode?: number }).responseCode
      throw new FalhaEntrega(
        code ? `SMTP_${code}` : 'SMTP_REDE',
        !!code && code >= 500,
      )
    }
  }
  fechar() {
    this.transporte?.close()
  }
}
