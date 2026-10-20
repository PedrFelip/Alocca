import { PasswordService } from './password.service.ts'

describe('PasswordService', () => {
  const service = new PasswordService()

  it('gera hashes diferentes com salt e verifica somente a senha correta', async () => {
    const first = await service.hash('senha-segura')
    const second = await service.hash('senha-segura')
    expect(first).not.toBe(second)
    expect(await service.verify('senha-segura', first)).toBe(true)
    expect(await service.verify('outra-senha', first)).toBe(false)
    expect(await service.verify('senha-segura', 'hash-invalido')).toBe(false)
  })
})
