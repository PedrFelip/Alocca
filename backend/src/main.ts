import { ConfigService } from '@nestjs/config'
import { NestFactory } from '@nestjs/core'
import type { NestExpressApplication } from '@nestjs/platform-express'

import { AppModule } from './app.module.ts'
import type { Env } from './config/env.ts'

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule)
  const config = app.get(ConfigService<Env, true>)
  app.set('trust proxy', config.get('TRUST_PROXY', { infer: true }) || false)
  app.enableCors({
    origin: config.get('ADMIN_WEB_ORIGIN', { infer: true }),
    methods: ['GET', 'POST', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Authorization', 'Content-Type'],
  })
  await app.listen(
    config.get('PORT', { infer: true }),
    config.get('HOST', { infer: true }),
  )
}
await bootstrap()
