import { Module } from '@nestjs/common'
import { SecurityModule } from '../auth/security.module.ts'
import { DatabaseModule } from '../db/db.module.ts'
import { AgendaController } from './agenda.controller.ts'
import { AgendaService } from './agenda.service.ts'

@Module({
  imports: [DatabaseModule, SecurityModule],
  controllers: [AgendaController],
  providers: [AgendaService],
})
export class AgendaModule {}
