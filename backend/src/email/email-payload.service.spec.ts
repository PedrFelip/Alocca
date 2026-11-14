import { ConfigService } from '@nestjs/config'
import { describe, expect, it } from 'vitest'
import type { Env } from '../config/env.ts'
import { EmailPayloadService } from './email-payload.service.ts'

describe('EmailPayloadService', () => {
  const servico = new EmailPayloadService(
    new ConfigService<Env, true>({
      JWT_SECRET: 'test-only-secret-with-at-least-32-characters',
    }),
  )
  const email = {
    para: 'maria@example.com',
    assunto: 'Recuperação',
    texto: 'ABCD2345',
  }

  it('preserva o e-mail sem persistir código ou destinatário em claro', () => {
    const payload = servico.cifrar(email)
    expect(payload).not.toContain(email.texto)
    expect(payload).not.toContain(email.para)
    expect(servico.decifrar(payload)).toEqual(email)
    expect(servico.cifrar(email)).not.toBe(payload)
  })

  it('rejeita payload adulterado', () => {
    const payload = Buffer.from(servico.cifrar(email), 'base64')
    payload[payload.length - 1] ^= 1
    expect(() => servico.decifrar(payload.toString('base64'))).toThrow()
  })
})
