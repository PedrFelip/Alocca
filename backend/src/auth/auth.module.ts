import { Module } from '@nestjs/common'
import { UsuariosModule } from '../usuarios/usuarios.module.js'
import { AuthController } from './auth.controller.js'
import { AuthService } from './auth.service.js'
import { SecurityModule } from './security.module.js'
import { DatabaseModule } from '../db/db.module.js'
import { AdminBootstrapService } from './admin-bootstrap.service.js'

@Module({
  imports: [UsuariosModule, SecurityModule, DatabaseModule],
  controllers: [AuthController],
  providers: [AuthService, AdminBootstrapService],
})
export class AuthModule {}
