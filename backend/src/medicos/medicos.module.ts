import { Module } from '@nestjs/common'
import { SecurityModule } from '../auth/security.module.ts'
import { DatabaseModule } from '../db/db.module.ts'
import { MedicosController } from './medicos.controller.ts'
import { MedicosService } from './medicos.service.ts'

@Module({
  imports: [DatabaseModule, SecurityModule],
  controllers: [MedicosController],
  providers: [MedicosService],
})
export class MedicosModule {}
