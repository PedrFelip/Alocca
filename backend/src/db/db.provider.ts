import { ConfigService } from '@nestjs/config'
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'

import type { Env } from '../config/env.js'

export const DRIZZLE_DB = 'DrizzleAsyncProvider'
export type Database = PostgresJsDatabase

export const drizzleProvider = {
  provide: DRIZZLE_DB,
  inject: [ConfigService],
  useFactory: (configService: ConfigService<Env, true>): Database => {
    const client = postgres(configService.get('DATABASE_URL', { infer: true }))
    return drizzle({ client })
  },
}
