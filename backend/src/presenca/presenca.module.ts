import { Module } from '@nestjs/common'
import { SecurityModule } from '../auth/security.module.ts'
import { DatabaseModule } from '../db/db.module.ts'
import { PresencaController } from './presenca.controller.ts'
import { PresencaService } from './presenca.service.ts'

@Module({
  imports: [DatabaseModule, SecurityModule],
  controllers: [PresencaController],
  providers: [PresencaService],
})
export class PresencaModule {}
