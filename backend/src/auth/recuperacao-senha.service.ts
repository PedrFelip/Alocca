import { BadRequestException, Inject, Injectable, Logger } from '@nestjs/common'
import { and, eq, gt, isNull, sql } from 'drizzle-orm'
import { createHash, randomBytes } from 'node:crypto'
import { mensagensOficiais } from '../common/mensagens.ts'
import { DRIZZLE_DB, type Database } from '../db/db.provider.ts'
import { tokensRecuperacaoSenhaTable } from '../db/schemas/tokens-recuperacao-senha.ts'
import { usuariosTable } from '../db/schemas/usuarios.ts'
import { EmailService } from '../email/email.service.ts'
import { UsuariosService, type Usuario } from '../usuarios/usuarios.service.ts'
import type { RecuperarSenha, RedefinirSenha } from './auth.schemas.ts'
import { PasswordService } from './password.service.ts'

// no banco fica so o hash do codigo
export function hashDoToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

@Injectable()
export class RecuperacaoSenhaService {
  private readonly logger = new Logger(RecuperacaoSenhaService.name)

  constructor(
    @Inject(DRIZZLE_DB) private readonly db: Database,
    @Inject(UsuariosService) private readonly usuarios: UsuariosService,
    @Inject(PasswordService) private readonly passwords: PasswordService,
    @Inject(EmailService) private readonly email: EmailService,
  ) {}

  // RN12: resposta sempre igual
  async solicitar(data: RecuperarSenha) {
    const usuario = await this.usuarios.buscarCredenciais(data.email)
    if (usuario?.status === 'ATIVO') {
      // roda fora da resposta: conta ativa e inexistente demoram igual
      this.emitir(usuario).catch(() =>
        this.logger.error('Falha ao enviar e-mail de recuperação'),
      )
    }
    return { message: mensagensOficiais['MSG-05'] }
  }

  private async emitir(usuario: Usuario) {
    const token = randomBytes(32).toString('base64url')
    await this.db.transaction(async (tx) => {
      // trava o usuario: dois pedidos juntos ficam em fila
      await tx
        .select({ id: usuariosTable.id })
        .from(usuariosTable)
        .where(eq(usuariosTable.id, usuario.id))
        .for('update')
      // pediu de novo: o codigo antigo para de valer
      await tx
        .update(tokensRecuperacaoSenhaTable)
        .set({ used_at: sql`now()` })
        .where(
          and(
            eq(tokensRecuperacaoSenhaTable.usuario_id, usuario.id),
            isNull(tokensRecuperacaoSenhaTable.used_at),
          ),
        )
      // RN11: vale 15 min
      await tx.insert(tokensRecuperacaoSenhaTable).values({
        usuario_id: usuario.id,
        token: hashDoToken(token),
        expires_at: sql`now() + interval '15 minutes'`,
      })
    })
    await this.email.enviar({
      para: usuario.email,
      assunto: 'Alocca Plantões - redefinição de senha',
      texto: [
        `Olá, ${usuario.nome}.`,
        '',
        'Recebemos um pedido para redefinir a senha da sua conta no Alocca Plantões.',
        'Use o código abaixo para criar uma senha nova. Ele vale por 15 minutos e só pode ser usado uma vez:',
        '',
        token,
        '',
        'Se não foi você, pode ignorar este e-mail. Sua senha continua a mesma.',
      ].join('\n'),
    })
  }

  async redefinir(data: RedefinirSenha) {
    const senha_hash = await this.passwords.hash(data.nova_senha)
    const trocou = await this.db.transaction(async (tx) => {
      // usa e confere num update so, assim nao da pra usar 2 vezes
      const [token] = await tx
        .update(tokensRecuperacaoSenhaTable)
        .set({ used_at: sql`now()` })
        .where(
          and(
            eq(tokensRecuperacaoSenhaTable.token, hashDoToken(data.token)),
            isNull(tokensRecuperacaoSenhaTable.used_at),
            gt(tokensRecuperacaoSenhaTable.expires_at, sql`now()`),
          ),
        )
        .returning({ usuario_id: tokensRecuperacaoSenhaTable.usuario_id })
      if (!token) return false
      const [usuario] = await tx
        .update(usuariosTable)
        // tira o bloqueio de login tb
        .set({ senha_hash, tentativas_falhas: 0, bloqueado_ate: null })
        .where(
          and(
            eq(usuariosTable.id, token.usuario_id),
            eq(usuariosTable.status, 'ATIVO'),
            isNull(usuariosTable.deleted_at),
          ),
        )
        .returning({ id: usuariosTable.id })
      // conta desativada nao troca
      return Boolean(usuario)
    })
    if (!trocou) {
      throw new BadRequestException(mensagensOficiais['MSG-06'])
    }
    return { message: mensagensOficiais['MSG-08'] }
  }
}
