import { Module } from '@nestjs/common'
import { APP_GUARD } from '@nestjs/core'
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler'
import { AuthModule } from './auth/auth.module.js'
import { ConfigModule } from '@nestjs/config'

import { validateEnv } from './config/env.js'
import { DatabaseModule } from './db/db.module.js'
import { HealthModule } from './health/health.module.js'
import { MedicosModule } from './medicos/medicos.module.js'

@Module({
  imports: [
    ConfigModule.forRoot({
      ignoreEnvFile: process.env.NODE_ENV === 'test',
      cache: true,
      isGlobal: true,
      validate: validateEnv,
    }),
    DatabaseModule,
    AuthModule,
    HealthModule,
    MedicosModule,
    ThrottlerModule.forRoot([{ ttl: 60000, limit: 60 }]),
  ],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
