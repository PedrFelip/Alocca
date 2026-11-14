import { SecurityModule } from '../auth/security.module.ts'
import { ConsultasGestorController } from './consultas-gestor.controller.ts'
import { ConsultasGestorService } from './consultas-gestor.service.ts'
import { ConsultasGestorRepository } from './consultas-gestor.repository.ts'
import { AcessoInstitucionalService } from './acesso-institucional.service.ts'
import { Module } from '@nestjs/common'
import { DatabaseModule } from '../db/db.module.ts'
import { GestoresService } from './gestores.service.ts'

@Module({
  imports: [DatabaseModule, SecurityModule],
  controllers: [ConsultasGestorController],
  providers: [
    GestoresService,
    AcessoInstitucionalService,
    ConsultasGestorService,
    ConsultasGestorRepository,
  ],
  exports: [GestoresService, AcessoInstitucionalService],
})
export class GestoresModule {}
