import { Module } from '@nestjs/common'
import { SecurityModule } from '../auth/security.module.ts'
import { DatabaseModule } from '../db/db.module.ts'
import { EmailModule } from '../email/email.module.ts'
import { NotificacoesController } from './notificacoes.controller.ts'
import { NotificacoesService } from './notificacoes.service.ts'
import { NotificacoesWorker } from './notificacoes.worker.ts'
@Module({
  imports: [DatabaseModule, SecurityModule, EmailModule],
  controllers: [NotificacoesController],
  providers: [NotificacoesService, NotificacoesWorker],
  exports: [NotificacoesWorker],
})
export class NotificacoesModule {}
