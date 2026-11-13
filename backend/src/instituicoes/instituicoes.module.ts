import { Module } from '@nestjs/common'
import { SecurityModule } from '../auth/security.module.ts'
import { DatabaseModule } from '../db/db.module.ts'
import { GestoresModule } from '../gestores/gestores.module.ts'
import { InstituicoesController } from './instituicoes.controller.ts'
import { InstituicoesService } from './instituicoes.service.ts'

@Module({
  imports: [DatabaseModule, SecurityModule, GestoresModule],
  controllers: [InstituicoesController],
  providers: [InstituicoesService],
})
export class InstituicoesModule {}
