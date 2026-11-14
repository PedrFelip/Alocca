import { Module } from '@nestjs/common'
import { UsuariosModule } from '../usuarios/usuarios.module.ts'
import { AuthController } from './auth.controller.ts'
import { AuthService } from './auth.service.ts'
import { SecurityModule } from './security.module.ts'
import { DatabaseModule } from '../db/db.module.ts'
import { AdminBootstrapService } from './admin-bootstrap.service.ts'
import { EmailModule } from '../email/email.module.ts'
import { RecuperacaoSenhaService } from './recuperacao-senha.service.ts'

@Module({
  imports: [UsuariosModule, SecurityModule, DatabaseModule, EmailModule],
  controllers: [AuthController],
  providers: [AuthService, AdminBootstrapService, RecuperacaoSenhaService],
})
export class AuthModule {}
