import { EmailSender } from './email-sender.ts'
import { DatabaseModule } from '../db/db.module.ts'
import { EmailPayloadService } from './email-payload.service.ts'
import { EmailOutboxService } from './email-outbox.service.ts'
import { Module } from '@nestjs/common'
import { EmailService } from './email.service.ts'

@Module({
  imports: [DatabaseModule],
  providers: [
    { provide: EmailSender, useExisting: EmailService },
    EmailService,
    EmailPayloadService,
    EmailOutboxService,
  ],
  exports: [EmailSender, EmailService, EmailPayloadService],
})
export class EmailModule {}
