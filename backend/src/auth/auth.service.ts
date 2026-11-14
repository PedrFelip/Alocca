import {
  HttpException,
  InternalServerErrorException,
  Inject,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common'
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { and, eq, gt, isNull, sql } from 'drizzle-orm'
import { DRIZZLE_DB, type Database } from '../db/db.provider.ts'
import { sessoesAuthTable } from '../db/schemas/sessoes-auth.ts'
import { usuariosTable } from '../db/schemas/usuarios.ts'
import { ConfigService } from '@nestjs/config'
import { JwtService } from '@nestjs/jwt'
import type { Env } from '../config/env.ts'
import {
  mascararEmail,
  serializarLogCritico,
  type MotivoLoginFalho,
} from '../common/log-critico.ts'
import { mensagensOficiais } from '../common/mensagens.ts'
import { UsuariosService } from '../usuarios/usuarios.service.ts'
import type { Login } from './auth.schemas.ts'
import { PasswordService } from './password.service.ts'

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name)
  // Executa scrypt também quando o e-mail não existe.
  private readonly dummyHash: Promise<string>

  constructor(
    @Inject(UsuariosService) private readonly usuarios: UsuariosService,
    @Inject(PasswordService) private readonly passwords: PasswordService,
    @Inject(JwtService) private readonly jwt: JwtService,
    @Inject(ConfigService) private readonly config: ConfigService<Env, true>,
    @Inject(DRIZZLE_DB) private readonly db: Database,
  ) {
    this.dummyHash = this.passwords.hash('dummy-password-for-timing')
  }

  async login(data: Login) {
    const usuario = await this.usuarios.buscarCredenciais(data.email)
    if (usuario && (await this.usuarios.bloqueioLoginAtivo(usuario.id))) {
      this.registrarLoginFalho('CONTA_BLOQUEADA_RN08', data.email, usuario.id)
      throw new HttpException(mensagensOficiais['MSG-03'], 429)
    }
    const valid = await this.passwords.verify(
      data.senha,
      usuario?.senha_hash ?? (await this.dummyHash),
    )
    if (!usuario || !valid || usuario.status !== 'ATIVO') {
      if (!usuario) {
        this.registrarLoginFalho('EMAIL_INEXISTENTE', data.email, null)
      } else if (!valid) {
        const tentativa = await this.usuarios.registrarFalhaLogin(usuario.id)
        if (tentativa?.bloqueado_ate) {
          this.registrarLoginFalho(
            'CONTA_BLOQUEADA_RN08',
            data.email,
            usuario.id,
            tentativa.tentativas_falhas,
          )
          throw new HttpException(mensagensOficiais['MSG-03'], 429)
        }
        this.registrarLoginFalho(
          'SENHA_INCORRETA',
          data.email,
          usuario.id,
          tentativa?.tentativas_falhas,
        )
      } else {
        const motivo =
          usuario.status === 'BLOQUEADO'
            ? 'USUARIO_BLOQUEADO'
            : 'USUARIO_INATIVO'
        this.registrarLoginFalho(motivo, data.email, usuario.id)
      }
      throw new UnauthorizedException(mensagensOficiais['MSG-01'])
    }
    if (!(await this.usuarios.registrarLogin(usuario.id))) {
      this.registrarLoginFalho('CONTA_BLOQUEADA_RN08', data.email, usuario.id)
      throw new HttpException(mensagensOficiais['MSG-03'], 429)
    }
    const refreshToken = randomBytes(32).toString('base64url')
    const sessao = await this.db
      .transaction(async (tx) => {
        // Serializa criação da sessão com reset de senha e revalida o hash observado.
        const [credencial] = await tx
          .update(usuariosTable)
          .set({ ultimo_login_at: sql`${usuariosTable.ultimo_login_at}` })
          .where(
            and(
              eq(usuariosTable.id, usuario.id),
              eq(usuariosTable.senha_hash, usuario.senha_hash),
              eq(usuariosTable.status, 'ATIVO'),
              isNull(usuariosTable.deleted_at),
            ),
          )
          .returning({ id: usuariosTable.id })
        if (!credencial)
          throw new UnauthorizedException(
            'Credenciais alteradas; entre novamente',
          )
        const [criada] = await tx
          .insert(sessoesAuthTable)
          .values({
            usuario_id: usuario.id,
            token_hash: this.hashToken(refreshToken),
            expires_at: this.refreshExpiraEm(),
          })
          .returning({ id: sessoesAuthTable.id })
        return criada
      })
      .catch((erro: unknown) => {
        if (erro instanceof UnauthorizedException) throw erro
        throw new InternalServerErrorException()
      })
    return this.resposta(usuario.id, sessao.id, refreshToken)
  }

  async refresh(refreshToken: string) {
    const novoToken = randomBytes(32).toString('base64url')
    // UPDATE condicional bloqueia a linha e reavalia o hash após concorrência.
    const renovada = await this.db
      .transaction(async (tx) => {
        const [sessao] = await tx
          .update(sessoesAuthTable)
          .set({
            token_hash: this.hashToken(novoToken),
            expires_at: this.refreshExpiraEm(),
          })
          .where(
            and(
              eq(sessoesAuthTable.token_hash, this.hashToken(refreshToken)),
              isNull(sessoesAuthTable.revogado_at),
              gt(sessoesAuthTable.expires_at, new Date()),
              sql`EXISTS (SELECT 1 FROM ${usuariosTable} u WHERE u.id = ${sessoesAuthTable.usuario_id} AND u.status = 'ATIVO' AND u.deleted_at IS NULL)`,
            ),
          )
          .returning({
            id: sessoesAuthTable.id,
            usuarioId: sessoesAuthTable.usuario_id,
          })
        if (!sessao)
          throw new UnauthorizedException('Token inválido ou expirado')
        return sessao
      })
      .catch((erro: unknown) => {
        if (erro instanceof UnauthorizedException) throw erro
        throw new InternalServerErrorException()
      })
    // Liberar conexão da transação antes de consultar perfil no pool externo.
    return this.resposta(renovada.usuarioId, renovada.id, novoToken)
  }

  async logout(
    usuarioId: string,
    sessaoId: string | undefined,
    tokenHash: string,
    expiresAt: Date,
  ) {
    if (sessaoId) {
      await this.db
        .update(sessoesAuthTable)
        .set({ revogado_at: new Date() })
        .where(
          and(
            eq(sessoesAuthTable.id, sessaoId),
            eq(sessoesAuthTable.usuario_id, usuarioId),
          ),
        )
        .catch(() => {
          throw new InternalServerErrorException()
        })
    } else {
      // JWTs anteriores não têm sid: guardar um tombstone até sua expiração.
      await this.db
        .insert(sessoesAuthTable)
        .values({
          usuario_id: usuarioId,
          token_hash: tokenHash,
          expires_at: expiresAt,
          revogado_at: new Date(),
        })
        .onConflictDoNothing()
        .catch(() => {
          throw new InternalServerErrorException()
        })
    }
  }

  private hashToken(token: string) {
    return createHash('sha256').update(token).digest('hex')
  }

  private refreshExpiraEm() {
    // Janela deslizante de 30 dias por padrão; validação de ambiente integrada separadamente.
    const configurado = Number(
      this.config.get('REFRESH_TOKEN_TTL_SECONDS' as keyof Env),
    )
    const ttl =
      Number.isSafeInteger(configurado) && configurado > 0
        ? configurado
        : 2592000
    return new Date(Date.now() + ttl * 1000)
  }

  private async resposta(usuarioId: string, sid: string, refreshToken: string) {
    return {
      access_token: await this.jwt.signAsync({
        sub: usuarioId,
        jti: randomUUID(),
        sid,
      }),
      refresh_token: refreshToken,
      token_type: 'Bearer',
      expires_in: this.config.get('JWT_EXPIRES', { infer: true }),
      usuario: await this.usuarios.perfil(usuarioId),
    }
  }

  private registrarLoginFalho(
    motivo: MotivoLoginFalho,
    email: string,
    usuarioId: string | null,
    tentativasFalhas?: number,
  ): void {
    this.logger.warn(
      serializarLogCritico({
        evento: 'LOGIN_FALHO',
        motivo,
        usuario_id: usuarioId,
        email_mascarado: mascararEmail(email),
        ...(tentativasFalhas !== undefined && {
          tentativas_falhas: tentativasFalhas,
        }),
      }),
    )
  }
}
