import { Module } from '@nestjs/common'
import { SecurityModule } from '../auth/security.module.ts'
import { DatabaseModule } from '../db/db.module.ts'
import { FinanceiroController } from './financeiro.controller.ts'
import { FinanceiroService } from './financeiro.service.ts'

@Module({
  imports: [DatabaseModule, SecurityModule],
  controllers: [FinanceiroController],
  providers: [FinanceiroService],
})
export class FinanceiroModule {}
