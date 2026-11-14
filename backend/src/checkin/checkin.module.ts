import { CheckinRepository } from './checkin.repository.ts'
import { PerfilMedicoModule } from '../medicos/perfil-medico.module.ts'
import { Module } from '@nestjs/common'
import { SecurityModule } from '../auth/security.module.ts'
import { DatabaseModule } from '../db/db.module.ts'
import { CheckinController } from './checkin.controller.ts'
import { CheckinService } from './checkin.service.ts'

@Module({
  imports: [PerfilMedicoModule, DatabaseModule, SecurityModule],
  controllers: [CheckinController],
  providers: [CheckinService, CheckinRepository],
})
export class CheckinModule {}
