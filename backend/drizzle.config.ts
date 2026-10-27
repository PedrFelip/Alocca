import 'dotenv/config'
import { defineConfig } from 'drizzle-kit'

import { validateEnv } from './src/config/env.ts'

const env = validateEnv(process.env)

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schemas/index.ts',
  out: './drizzle',
  dbCredentials: {
    url: env.DATABASE_URL,
  },
})
