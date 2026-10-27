import { Module } from '@nestjs/common'
import { SecurityModule } from '../auth/security.module.ts'
import { DatabaseModule } from '../db/db.module.ts'
import { CandidaturasController } from './candidaturas.controller.ts'
import { CandidaturasService } from './candidaturas.service.ts'

@Module({
  imports: [DatabaseModule, SecurityModule],
  controllers: [CandidaturasController],
  providers: [CandidaturasService],
})
export class CandidaturasModule {}
