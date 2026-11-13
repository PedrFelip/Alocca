import { Module } from '@nestjs/common'
import { SecurityModule } from '../auth/security.module.ts'
import { DatabaseModule } from '../db/db.module.ts'
import { GestoresModule } from '../gestores/gestores.module.ts'
import { CandidaturasController, MinhasCandidaturasController } from './candidaturas.controller.ts'
import { CandidaturasService } from './candidaturas.service.ts'

@Module({
  imports: [DatabaseModule, SecurityModule, GestoresModule],
  controllers: [CandidaturasController, MinhasCandidaturasController],
  providers: [CandidaturasService],
})
export class CandidaturasModule {}
