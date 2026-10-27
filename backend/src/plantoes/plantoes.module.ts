import { Module } from '@nestjs/common'
import { SecurityModule } from '../auth/security.module.ts'
import { DatabaseModule } from '../db/db.module.ts'
import { PlantoesController } from './plantoes.controller.ts'
import { PlantoesService } from './plantoes.service.ts'

@Module({
  imports: [DatabaseModule, SecurityModule],
  controllers: [PlantoesController],
  providers: [PlantoesService],
})
export class PlantoesModule {}
