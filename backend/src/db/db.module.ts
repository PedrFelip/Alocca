import { Module } from '@nestjs/common'

import { DRIZZLE_DB, drizzleProvider } from './db.provider.ts'

@Module({
  providers: [drizzleProvider],
  exports: [DRIZZLE_DB],
})
export class DatabaseModule {}
