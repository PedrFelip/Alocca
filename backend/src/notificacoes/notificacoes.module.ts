import { Module } from '@nestjs/common'
import { SecurityModule } from '../auth/security.module.ts'
import { DatabaseModule } from '../db/db.module.ts'
import { NotificacoesController } from './notificacoes.controller.ts'
import { NotificacoesService } from './notificacoes.service.ts'

@Module({
  imports: [DatabaseModule, SecurityModule],
  controllers: [NotificacoesController],
  providers: [NotificacoesService],
})
export class NotificacoesModule {}
