import { z } from 'zod'

// campo vazio no .env = nao configurado
const vazioViraNada = (valor: unknown) => (valor === '' ? undefined : valor)

const envSchema = z
  .object({
    NODE_ENV: z
      .enum(['development', 'test', 'production'])
      .default('development'),
    HOST: z.string().trim().min(1).default('127.0.0.1'),
    PORT: z.coerce.number().int().min(1).max(65_535).default(3_000),
    JWT_SECRET: z
      .string()
      .min(32, 'JWT_SECRET deve ter pelo menos 32 caracteres'),
    JWT_EXPIRES: z.coerce.number().int().min(60).max(86400).default(900),
    ADMIN_WEB_ORIGIN: z.url().default('http://localhost:5173'),
    ADMIN_EMAIL: z.email().trim().toLowerCase().optional(),
    ADMIN_PASSWORD: z.string().min(8).max(128).optional(),
    DATABASE_URL: z.string().url('DATABASE_URL deve ser uma URL válida'),
    // sem smtp o back sobe, so nao manda e-mail
    SMTP_HOST: z.preprocess(vazioViraNada, z.string().trim().min(1).optional()),
    SMTP_PORT: z.preprocess(
      vazioViraNada,
      z.coerce.number().int().min(1).max(65_535).default(465),
    ),
    SMTP_USER: z.preprocess(vazioViraNada, z.string().trim().min(1).optional()),
    SMTP_PASS: z.preprocess(vazioViraNada, z.string().min(1).optional()),
    SMTP_FROM: z.preprocess(vazioViraNada, z.string().trim().min(1).optional()),
  })
  .refine((env) => Boolean(env.ADMIN_EMAIL) === Boolean(env.ADMIN_PASSWORD), {
    message: 'Configure ADMIN_EMAIL e ADMIN_PASSWORD juntos',
  })
  .refine((env) => Boolean(env.SMTP_USER) === Boolean(env.SMTP_PASS), {
    message: 'Configure SMTP_USER e SMTP_PASS juntos',
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
