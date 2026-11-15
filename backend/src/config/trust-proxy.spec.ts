import { ExpressAdapter } from '@nestjs/platform-express'
import request from 'supertest'
import { validateEnv } from './env.ts'

function server(trustProxy?: string) {
  const config = validateEnv({
    JWT_SECRET: 'test-only-secret-with-at-least-32-characters',
    DATABASE_URL: 'postgresql://localhost/alocca_test',
    TRUST_PROXY: trustProxy,
  })
  const app = new ExpressAdapter().getInstance()
  app.set('trust proxy', config.TRUST_PROXY || false)
  app.get('/', (req, res) => res.json({ ip: req.ip }))
  return app
}

describe('IP usado pelo throttle atrás do proxy', () => {
  it('distingue clientes encaminhados por um proxy confiável', async () => {
    const app = server('loopback')
    for (const ip of ['203.0.113.1', '203.0.113.2']) {
      const response = await request(app).get('/').set('X-Forwarded-For', ip)
      expect(response.body.ip).toBe(ip)
    }
  })

  it('ignora cabeçalhos encaminhados sem proxy confiável', async () => {
    const response = await request(server())
      .get('/')
      .set('X-Forwarded-For', '203.0.113.1')
    expect(response.body.ip).not.toBe('203.0.113.1')
  })

  it('ignora cabeçalhos de um remetente fora da rede confiável', async () => {
    const response = await request(server('192.0.2.0/24'))
      .get('/')
      .set('X-Forwarded-For', '203.0.113.1')
    expect(response.body.ip).not.toBe('203.0.113.1')
  })
})
