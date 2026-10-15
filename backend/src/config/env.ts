import { z } from 'zod'

const envSchema = z
  .object({
    NODE_ENV: z
      .enum(['development', 'test', 'production'])
      .default('development'),
    PORT: z.coerce.number().int().min(1).max(65_535).default(3_000),
    JWT_SECRET: z
      .string()
      .min(32, 'JWT_SECRET deve ter pelo menos 32 caracteres'),
    JWT_EXPIRES: z.coerce.number().int().min(60).max(86400).default(900),
    ADMIN_WEB_ORIGIN: z.url().default('http://localhost:5173'),
    ADMIN_EMAIL: z.email().trim().toLowerCase().optional(),
    ADMIN_PASSWORD: z.string().min(8).max(128).optional(),
    DATABASE_URL: z.string().url('DATABASE_URL deve ser uma URL válida'),
  })
  .refine((env) => Boolean(env.ADMIN_EMAIL) === Boolean(env.ADMIN_PASSWORD), {
    message: 'Configure ADMIN_EMAIL e ADMIN_PASSWORD juntos',
  })

export type Env = z.infer<typeof envSchema>

export function validateEnv(config: Record<string, unknown>): Env {
  const result = envSchema.safeParse(config)

  if (!result.success) {
    const details = result.error.issues
      .map(({ path, message }) => `${path.join('.') || 'env'}: ${message}`)
      .join('; ')

    throw new Error(`Variáveis de ambiente inválidas: ${details}`)
  }

  return result.data
}
