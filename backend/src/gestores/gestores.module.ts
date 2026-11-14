import { AcessoInstitucionalService } from './acesso-institucional.service.ts'
import { Module } from '@nestjs/common'
import { DatabaseModule } from '../db/db.module.ts'
import { GestoresService } from './gestores.service.ts'

@Module({
  imports: [DatabaseModule],
  providers: [GestoresService, AcessoInstitucionalService],
  exports: [GestoresService, AcessoInstitucionalService],
})
export class GestoresModule {}
