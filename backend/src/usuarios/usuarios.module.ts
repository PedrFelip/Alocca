import { Module } from '@nestjs/common'
import { SecurityModule } from '../auth/security.module.js'
import { DatabaseModule } from '../db/db.module.js'
import { UsuariosController } from './usuarios.controller.js'
import { UsuariosService } from './usuarios.service.js'

@Module({
  imports: [DatabaseModule, SecurityModule],
  controllers: [UsuariosController],
  providers: [UsuariosService],
  exports: [UsuariosService],
})
export class UsuariosModule {}
