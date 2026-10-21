import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { eq } from 'drizzle-orm'
import type { Env } from '../config/env.ts'
import { DRIZZLE_DB, type Database } from '../db/db.provider.ts'
import { usuariosTable } from '../db/schemas/usuarios.ts'
import { PasswordService } from './password.service.ts'

@Injectable()
export class AdminBootstrapService implements OnModuleInit {
  private readonly logger = new Logger(AdminBootstrapService.name)

  constructor(
    @Inject(DRIZZLE_DB) private readonly db: Database,
    private readonly config: ConfigService<Env, true>,
    private readonly passwords: PasswordService,
  ) {}

  async onModuleInit(): Promise<void> {
    const email = this.config.get('ADMIN_EMAIL', { infer: true })
    const senha = this.config.get('ADMIN_PASSWORD', { infer: true })
    if (!email || !senha) return

    const [existing] = await this.db
      .select({ id: usuariosTable.id })
      .from(usuariosTable)
      .where(eq(usuariosTable.email, email))
      .limit(1)
    if (existing) return

    const inserted = await this.db
      .insert(usuariosTable)
      .values({
        nome: 'Administrador Alocca',
        email,
        senha_hash: await this.passwords.hash(senha),
        tipo: 'ADMIN',
        status: 'ATIVO',
      })
      .onConflictDoNothing({ target: usuariosTable.email })
      .returning({ id: usuariosTable.id })
    if (inserted.length) this.logger.log('Administrador inicial criado.')
  }
}
