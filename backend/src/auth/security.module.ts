import { Module } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { JwtModule } from '@nestjs/jwt'
import type { Env } from '../config/env.js'
import { DatabaseModule } from '../db/db.module.js'
import { AuthGuard } from './auth.guard.js'
import { PasswordService } from './password.service.js'
import { PermissoesGuard } from './permissoes.guard.js'

@Module({
  imports: [
    DatabaseModule,
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => ({
        secret: config.get('JWT_SECRET', { infer: true }),
        signOptions: {
          algorithm: 'HS256' as const,
          expiresIn: config.get('JWT_EXPIRES', { infer: true }),
        },
      }),
    }),
  ],
  providers: [AuthGuard, PasswordService, PermissoesGuard],
  exports: [JwtModule, AuthGuard, PasswordService, PermissoesGuard],
})
export class SecurityModule {}
