import { Module } from '@nestjs/common'
import { UsuariosModule } from '../usuarios/usuarios.module.ts'
import { AuthController } from './auth.controller.ts'
import { AuthService } from './auth.service.ts'
import { SecurityModule } from './security.module.ts'
import { DatabaseModule } from '../db/db.module.ts'
import { AdminBootstrapService } from './admin-bootstrap.service.ts'

@Module({
  imports: [UsuariosModule, SecurityModule, DatabaseModule],
  controllers: [AuthController],
  providers: [AuthService, AdminBootstrapService],
})
export class AuthModule {}
