import { Module } from '@nestjs/common'
import { DatabaseModule } from '../db/db.module.ts'
import { PerfilMedicoService } from './perfil-medico.service.ts'

@Module({
  imports: [DatabaseModule],
  providers: [PerfilMedicoService],
  exports: [PerfilMedicoService],
})
export class PerfilMedicoModule {}
