import { AlocacaoRepository } from './alocacao.repository.ts'
import { AprovarCandidaturaUseCase } from './aprovar-candidatura.use-case.ts'
import { PerfilMedicoModule } from '../medicos/perfil-medico.module.ts'
import { Module } from '@nestjs/common'
import { SecurityModule } from '../auth/security.module.ts'
import { DatabaseModule } from '../db/db.module.ts'
import { GestoresModule } from '../gestores/gestores.module.ts'
import {
  CandidaturasController,
  MinhasCandidaturasController,
} from './candidaturas.controller.ts'
import { CandidaturasService } from './candidaturas.service.ts'

@Module({
  imports: [PerfilMedicoModule, DatabaseModule, SecurityModule, GestoresModule],
  controllers: [CandidaturasController, MinhasCandidaturasController],
  providers: [
    CandidaturasService,
    AlocacaoRepository,
    AprovarCandidaturaUseCase,
  ],
})
export class CandidaturasModule {}
