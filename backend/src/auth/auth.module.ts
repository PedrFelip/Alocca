import { Module } from '@nestjs/common'
import { UsuariosModule } from '../usuarios/usuarios.module.js'
import { AuthController } from './auth.controller.js'
import { AuthService } from './auth.service.js'
import { SecurityModule } from './security.module.js'

@Module({
  imports: [UsuariosModule, SecurityModule],
  controllers: [AuthController],
  providers: [AuthService],
})
export class AuthModule {}
