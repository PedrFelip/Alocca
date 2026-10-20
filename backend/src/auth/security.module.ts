import { Module } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { JwtModule } from '@nestjs/jwt'
import type { Env } from '../config/env.ts'
import { DatabaseModule } from '../db/db.module.ts'
import { AuthGuard } from './auth.guard.ts'
import { PasswordService } from './password.service.ts'
import { PermissoesGuard } from './permissoes.guard.ts'

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
