import { Module } from '@nestjs/common'
import { APP_GUARD } from '@nestjs/core'
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler'
import { AuthModule } from './auth/auth.module.ts'
import { ConfigModule } from '@nestjs/config'

import { validateEnv } from './config/env.ts'
import { DatabaseModule } from './db/db.module.ts'
import { AgendaModule } from './agenda/agenda.module.ts'
import { HealthModule } from './health/health.module.ts'
import { MedicosModule } from './medicos/medicos.module.ts'
import { CandidaturasModule } from './candidaturas/candidaturas.module.ts'
import { PlantoesModule } from './plantoes/plantoes.module.ts'

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
    AgendaModule,
    HealthModule,
    MedicosModule,
    PlantoesModule,
    CandidaturasModule,
    ThrottlerModule.forRoot([{ ttl: 60000, limit: 60 }]),
  ],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
