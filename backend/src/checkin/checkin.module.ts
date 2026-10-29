import { Module } from '@nestjs/common'
import { SecurityModule } from '../auth/security.module.ts'
import { DatabaseModule } from '../db/db.module.ts'
import { CheckinController } from './checkin.controller.ts'
import { CheckinService } from './checkin.service.ts'

@Module({
  imports: [DatabaseModule, SecurityModule],
  controllers: [CheckinController],
  providers: [CheckinService],
})
export class CheckinModule {}
