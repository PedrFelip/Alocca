import { Inject, Injectable } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from 'node:crypto'
import type { Env } from '../config/env.ts'
import type { Email } from './email-sender.ts'

@Injectable()
export class EmailPayloadService {
  private readonly chave: Buffer
  constructor(@Inject(ConfigService) config: ConfigService<Env, true>) {
    this.chave = createHash('sha256')
      .update(
        config.get('EMAIL_OUTBOX_SECRET', { infer: true }) ??
          config.get('JWT_SECRET', { infer: true }),
      )
      .digest()
  }

  cifrar(email: Email): string {
    const iv = randomBytes(12)
    const cipher = createCipheriv('aes-256-gcm', this.chave, iv)
    const data = Buffer.concat([
      cipher.update(JSON.stringify(email), 'utf8'),
      cipher.final(),
    ])
    return Buffer.concat([iv, cipher.getAuthTag(), data]).toString('base64')
  }

  decifrar(payload: string): Email {
    const bytes = Buffer.from(payload, 'base64')
    const cipher = createDecipheriv(
      'aes-256-gcm',
      this.chave,
      bytes.subarray(0, 12),
    )
    cipher.setAuthTag(bytes.subarray(12, 28))
    return JSON.parse(
      Buffer.concat([
        cipher.update(bytes.subarray(28)),
        cipher.final(),
      ]).toString('utf8'),
    ) as Email
  }
}
