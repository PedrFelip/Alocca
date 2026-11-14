import { PerfilMedicoModule } from '../medicos/perfil-medico.module.ts'
import { GestoresModule } from '../gestores/gestores.module.ts'
import { ComprovantesStorage } from './comprovantes.storage.ts'
import { FinanceiroRepository } from './financeiro.repository.ts'
import { Module } from '@nestjs/common'
import { SecurityModule } from '../auth/security.module.ts'
import { DatabaseModule } from '../db/db.module.ts'
import { FinanceiroController } from './financeiro.controller.ts'
import { FinanceiroService } from './financeiro.service.ts'

@Module({
  imports: [PerfilMedicoModule, DatabaseModule, SecurityModule, GestoresModule],
  controllers: [FinanceiroController],
  providers: [FinanceiroService, ComprovantesStorage, FinanceiroRepository],
})
export class FinanceiroModule {}
