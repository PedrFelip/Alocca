import { Module } from '@nestjs/common'
import { DatabaseModule } from '../db/db.module.ts'
import { GestoresService } from './gestores.service.ts'

@Module({
  imports: [DatabaseModule],
  providers: [GestoresService],
  exports: [GestoresService],
})
export class GestoresModule {}
