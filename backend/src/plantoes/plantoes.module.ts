import { Module } from '@nestjs/common'
import { SecurityModule } from '../auth/security.module.js'
import { DatabaseModule } from '../db/db.module.js'
import { PlantoesController } from './plantoes.controller.js'
import { PlantoesService } from './plantoes.service.js'

@Module({
  imports: [DatabaseModule, SecurityModule],
  controllers: [PlantoesController],
  providers: [PlantoesService],
})
export class PlantoesModule {}
