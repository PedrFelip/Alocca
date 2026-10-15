import { Module } from '@nestjs/common'
import { SecurityModule } from '../auth/security.module.js'
import { DatabaseModule } from '../db/db.module.js'
import { MedicosController } from './medicos.controller.js'
import { MedicosService } from './medicos.service.js'

@Module({
  imports: [DatabaseModule, SecurityModule],
  controllers: [MedicosController],
  providers: [MedicosService],
})
export class MedicosModule {}
