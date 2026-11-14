import {
  BadRequestException,
  HttpException,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common'
import { and, count, eq, gt, isNull, sql } from 'drizzle-orm'
import { createHash, randomInt } from 'node:crypto'
import { mensagensOficiais } from '../common/mensagens.ts'
import { DRIZZLE_DB, type Database } from '../db/db.provider.ts'
import { tokensRecuperacaoSenhaTable } from '../db/schemas/tokens-recuperacao-senha.ts'
import {
  desafiosMobileTable,
  sessoesMobileTable,
} from '../db/schemas/sessoes-mobile.ts'
import { usuariosTable } from '../db/schemas/usuarios.ts'
import { EmailPayloadService } from '../email/email-payload.service.ts'
import { emailsPendentesTable } from '../db/schemas/emails-pendentes.ts'
import { UsuariosService, type Usuario } from '../usuarios/usuarios.service.ts'
import type {
  AlterarSenha,
  RecuperarSenha,
  RedefinirSenha,
} from './auth.schemas.ts'
import { PasswordService } from './password.service.ts'

const LIMITE_POR_CONTA = 3 // pedidos a cada 15 min
// sem 0/O e 1/I pra nao confundir na hora de digitar
const LETRAS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

// codigo curto pra digitar no celular
export function gerarCodigo(): string {
  let codigo = ''
  for (let i = 0; i < 8; i++) codigo += LETRAS[randomInt(LETRAS.length)]
  return codigo
}

// no banco fica so o hash do codigo
export function hashDoToken(token: string): string {
  return createHash('sha256').update(token.trim().toUpperCase()).digest('hex')
}

@Injectable()
export class RecuperacaoSenhaService {
  constructor(
    @Inject(DRIZZLE_DB) private readonly db: Database,
    @Inject(UsuariosService) private readonly usuarios: UsuariosService,
    @Inject(PasswordService) private readonly passwords: PasswordService,
    @Inject(EmailPayloadService) private readonly payloads: EmailPayloadService,
  ) {}

  // RN12: resposta sempre igual
  async solicitar(data: RecuperarSenha) {
    const usuario = await this.usuarios.buscarCredenciais(data.email)
    if (usuario?.status === 'ATIVO') {
      await this.emitir(usuario)
    }
    return { message: mensagensOficiais['MSG-05'] }
  }

  private async emitir(usuario: Usuario) {
    const token = gerarCodigo()
    const payload = this.payloads.cifrar({
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
    await this.db.transaction(async (tx) => {
      // trava o usuario: dois pedidos juntos ficam em fila
      await tx
        .select({ id: usuariosTable.id })
        .from(usuariosTable)
        .where(eq(usuariosTable.id, usuario.id))
        .for('update')
      // limite por conta, nao por ip: senao da pra encher a caixa da pessoa
      const [recentes] = await tx
        .select({ total: count() })
        .from(tokensRecuperacaoSenhaTable)
        .where(
          and(
            eq(tokensRecuperacaoSenhaTable.usuario_id, usuario.id),
            gt(
              tokensRecuperacaoSenhaTable.created_at,
              sql`now() - interval '15 minutes'`,
            ),
          ),
        )
      if (recentes.total >= LIMITE_POR_CONTA) return
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
      const [criado] = await tx
        .insert(tokensRecuperacaoSenhaTable)
        .values({
          usuario_id: usuario.id,
          token: hashDoToken(token),
          expires_at: sql`now() + interval '15 minutes'`,
        })
        .returning({ id: tokensRecuperacaoSenhaTable.id })
      await tx
        .insert(emailsPendentesTable)
        .values({ token_id: criado.id, payload })
    })
  }

  async alterar(usuarioId: string, versaoSessao: number, data: AlterarSenha) {
    const resultado = await this.db.transaction(async (tx) => {
      const [usuario] = await tx
        .select()
        .from(usuariosTable)
        .where(
          and(
            eq(usuariosTable.id, usuarioId),
            eq(usuariosTable.status, 'ATIVO'),
            isNull(usuariosTable.deleted_at),
          ),
        )
        .for('update')
      if (!usuario || usuario.versao_sessao !== versaoSessao) return 'invalido'
      const agora = new Date()
      const inicio = usuario.inicio_tentativas_alteracao_senha
      const dentroJanela = inicio && agora.getTime() - inicio.getTime() < 60000
      const tentativas = dentroJanela ? usuario.tentativas_alteracao_senha : 0
      if (tentativas >= 5) return 'limite'
      await tx
        .update(usuariosTable)
        .set({
          tentativas_alteracao_senha: tentativas + 1,
          inicio_tentativas_alteracao_senha: dentroJanela ? inicio : agora,
        })
        .where(eq(usuariosTable.id, usuarioId))
      if (!(await this.passwords.verify(data.senha_atual, usuario.senha_hash)))
        return 'invalido'
      const senha_hash = await this.passwords.hash(data.nova_senha)
      await tx
        .update(usuariosTable)
        .set({
          senha_hash,
          versao_sessao: sql`${usuariosTable.versao_sessao} + 1`,
          tentativas_alteracao_senha: 0,
          inicio_tentativas_alteracao_senha: null,
        })
        .where(eq(usuariosTable.id, usuarioId))
      await tx
        .update(tokensRecuperacaoSenhaTable)
        .set({ used_at: sql`now()` })
        .where(
          and(
            eq(tokensRecuperacaoSenhaTable.usuario_id, usuarioId),
            isNull(tokensRecuperacaoSenhaTable.used_at),
          ),
        )
      await tx
        .update(sessoesMobileTable)
        .set({ revoked_at: sql`now()` })
        .where(
          and(
            eq(sessoesMobileTable.usuario_id, usuarioId),
            isNull(sessoesMobileTable.revoked_at),
          ),
        )
      await tx
        .update(desafiosMobileTable)
        .set({ used_at: sql`now()`, pin_hash: null })
        .where(
          and(
            eq(desafiosMobileTable.usuario_id, usuarioId),
            isNull(desafiosMobileTable.used_at),
          ),
        )
      return 'ok'
    })
    if (resultado === 'limite')
      throw new HttpException(
        'Muitas tentativas. Tente novamente em instantes.',
        429,
      )
    if (resultado !== 'ok')
      throw new UnauthorizedException(mensagensOficiais['MSG-01'])
    return { message: mensagensOficiais['MSG-08'] }
  }

  async redefinir(data: RedefinirSenha) {
    const senha_hash = await this.passwords.hash(data.nova_senha)
    const trocou = await this.db.transaction(async (tx) => {
      const [referencia] = await tx
        .select({ usuario_id: tokensRecuperacaoSenhaTable.usuario_id })
        .from(tokensRecuperacaoSenhaTable)
        .where(eq(tokensRecuperacaoSenhaTable.token, hashDoToken(data.token)))
      if (!referencia) return false
      const [usuario] = await tx
        .select({ id: usuariosTable.id })
        .from(usuariosTable)
        .where(
          and(
            eq(usuariosTable.id, referencia.usuario_id),
            eq(usuariosTable.status, 'ATIVO'),
            isNull(usuariosTable.deleted_at),
          ),
        )
        .for('update')
      if (!usuario) return false
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
        .returning({ id: tokensRecuperacaoSenhaTable.id })
      if (!token) return false
      await tx
        .update(usuariosTable)
        .set({
          senha_hash,
          tentativas_falhas: 0,
          bloqueado_ate: null,
          versao_sessao: sql`${usuariosTable.versao_sessao} + 1`,
          tentativas_alteracao_senha: 0,
          inicio_tentativas_alteracao_senha: null,
        })
        .where(eq(usuariosTable.id, usuario.id))
      await tx
        .update(tokensRecuperacaoSenhaTable)
        .set({ used_at: sql`now()` })
        .where(
          and(
            eq(tokensRecuperacaoSenhaTable.usuario_id, usuario.id),
            isNull(tokensRecuperacaoSenhaTable.used_at),
          ),
        )
      await tx
        .update(sessoesMobileTable)
        .set({ revoked_at: sql`now()` })
        .where(
          and(
            eq(sessoesMobileTable.usuario_id, usuario.id),
            isNull(sessoesMobileTable.revoked_at),
          ),
        )
      await tx
        .update(desafiosMobileTable)
        .set({ used_at: sql`now()`, pin_hash: null })
        .where(
          and(
            eq(desafiosMobileTable.usuario_id, usuario.id),
            isNull(desafiosMobileTable.used_at),
          ),
        )
      return true
    })
    if (!trocou) throw new BadRequestException(mensagensOficiais['MSG-06'])
    return { message: mensagensOficiais['MSG-08'] }
  }
}
