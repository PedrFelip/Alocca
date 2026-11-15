import { Module } from '@nestjs/common'
import { DatabaseModule } from '../db/db.module.ts'
import { EmailModule } from '../email/email.module.ts'
import { NotificacoesModule } from '../notificacoes/notificacoes.module.ts'
import { QueueOutboxRepository } from './queue-outbox.repository.ts'
import { QueueProducer, QueueService } from './queue.service.ts'

@Module({
  imports: [DatabaseModule, EmailModule, NotificacoesModule],
  providers: [QueueOutboxRepository, QueueProducer, QueueService],
})
export class QueueModule {}
