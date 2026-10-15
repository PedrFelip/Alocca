import { Injectable } from '@nestjs/common'
import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto'
import { promisify } from 'node:util'

const deriveKey = promisify(scrypt)

@Injectable()
export class PasswordService {
  async hash(senha: string): Promise<string> {
    const salt = randomBytes(16).toString('hex')
    const key = (await deriveKey(senha, salt, 64)) as Buffer
    return `scrypt:${salt}:${key.toString('hex')}`
  }

  async verify(senha: string, hash: string): Promise<boolean> {
    const [algorithm, salt, stored] = hash.split(':')
    if (
      algorithm !== 'scrypt' ||
      !salt ||
      !stored ||
      !/^[a-f0-9]{128}$/.test(stored)
    )
      return false
    const key = (await deriveKey(senha, salt, 64)) as Buffer
    return timingSafeEqual(key, Buffer.from(stored, 'hex'))
  }
}
