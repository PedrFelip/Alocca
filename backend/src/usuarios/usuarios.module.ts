import { Module } from '@nestjs/common'
import { SecurityModule } from '../auth/security.module.ts'
import { DatabaseModule } from '../db/db.module.ts'
import { UsuariosController } from './usuarios.controller.ts'
import { UsuariosService } from './usuarios.service.ts'

@Module({
  imports: [DatabaseModule, SecurityModule],
  controllers: [UsuariosController],
  providers: [UsuariosService],
  exports: [UsuariosService],
})
export class UsuariosModule {}
