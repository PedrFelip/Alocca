import { InstituicoesRepository } from './instituicoes.repository.ts'
import { CacheModule } from '../cache/cache.module.ts'
import { Module } from '@nestjs/common'
import { SecurityModule } from '../auth/security.module.ts'
import { DatabaseModule } from '../db/db.module.ts'
import { GestoresModule } from '../gestores/gestores.module.ts'
import { InstituicoesController } from './instituicoes.controller.ts'
import { InstituicoesService } from './instituicoes.service.ts'

@Module({
  imports: [DatabaseModule, SecurityModule, GestoresModule, CacheModule],
  controllers: [InstituicoesController],
  providers: [InstituicoesRepository, InstituicoesService],
})
export class InstituicoesModule {}
