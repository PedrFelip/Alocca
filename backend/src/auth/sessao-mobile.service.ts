import {
  HttpException,
  Inject,
  Injectable,
  Logger,
  type OnModuleInit,
  type OnModuleDestroy,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { JwtService } from '@nestjs/jwt'
import { and, count, eq, gt, lt, inArray, isNull, sql } from 'drizzle-orm'
import {
  createHash,
  createHmac,
  hkdfSync,
  randomBytes,
  randomInt,
  timingSafeEqual,
} from 'node:crypto'
import type { Env } from '../config/env.ts'
import { DRIZZLE_DB, type Database } from '../db/db.provider.ts'
import {
  desafiosMobileTable as desafios,
  enviosPinTable as envios,
  sessoesMobileTable as sessoes,
  refreshMobileTable as refresh,
  usuariosTable as usuarios,
} from '../db/schemas/index.ts'
import { EmailService } from '../email/email.service.ts'
import { UsuariosService } from '../usuarios/usuarios.service.ts'
import { AuthService } from './auth.service.ts'
import type { Login } from './auth.schemas.ts'

const token = () => randomBytes(32).toString('base64url')
const hash = (value: string) => createHash('sha256').update(value).digest('hex')
const invalido = () =>
  new UnauthorizedException('Desafio ou sessão inválida ou expirada')

@Injectable()
export class SessaoMobileService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SessaoMobileService.name)
  private timer?: ReturnType<typeof setInterval>
  private limpeza?: Promise<void>
  onModuleInit() {
    if (this.config.get('NODE_ENV', { infer: true }) === 'test') return
    this.timer = setInterval(() => {
      if (!this.limpeza)
        this.limpeza = this.limpar()
          .catch(() => this.logger.error('Falha ao limpar sessões expiradas'))
          .finally(() => {
            this.limpeza = undefined
          })
    }, 3600000)
    this.timer.unref()
  }
  async onModuleDestroy() {
    clearInterval(this.timer)
    await this.limpeza
  }
  async limpar(): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx
        .delete(desafios)
        .where(lt(desafios.expires_at, sql`now() at time zone 'UTC'`))
      await tx
        .delete(envios)
        .where(
          lt(
            envios.created_at,
            sql`(now() at time zone 'UTC') - interval '15 minutes'`,
          ),
        )
      const expiradas = tx
        .select({ id: sessoes.id })
        .from(sessoes)
        .where(lt(sessoes.expires_at, sql`now() at time zone 'UTC'`))
      await tx.delete(refresh).where(inArray(refresh.sessao_id, expiradas))
      await tx
        .delete(sessoes)
        .where(lt(sessoes.expires_at, sql`now() at time zone 'UTC'`))
    })
  }

  constructor(
    @Inject(DRIZZLE_DB) private readonly db: Database,
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(UsuariosService) private readonly usuarios: UsuariosService,
    @Inject(JwtService) private readonly jwt: JwtService,
    @Inject(ConfigService) private readonly config: ConfigService<Env, true>,
    @Inject(EmailService) private readonly email: EmailService,
  ) {}
  private pinHash(id: string, pin: string) {
    const chave = Buffer.from(
      hkdfSync(
        'sha256',
        this.config.get('JWT_SECRET', { infer: true }),
        '',
        'alocca-mobile-pin-v1',
        32,
      ),
    )
    return createHmac('sha256', chave).update(`pin:${id}:${pin}`).digest('hex')
  }
  async login(data: Login, tipo: 'MEDICO' | 'GESTOR') {
    const usuario = await this.auth.autenticar(data)
    if (usuario.tipo !== tipo) throw invalido()
    const raw = token()
    const criado = await this.db.transaction(async (tx) => {
      const [u] = await tx
        .select()
        .from(usuarios)
        .where(eq(usuarios.id, usuario.id))
        .for('update')
      if (
        !u ||
        u.status !== 'ATIVO' ||
        u.deleted_at ||
        u.versao_sessao !== usuario.versao_sessao
      )
        return false
      await tx.insert(desafios).values({
        usuario_id: u.id,
        token_hash: hash(raw),
        expires_at: new Date(Date.now() + 300000),
      })
      return true
    })
    if (!criado) throw invalido()
    return { challenge_token: raw, requer_2fa: true, expires_in: 300 }
  }
  async solicitar(raw: string) {
    if (!this.config.get('SMTP_HOST', { infer: true }))
      throw new ServiceUnavailableException('Envio de e-mail indisponível')
    const result = await this.db.transaction(async (tx) => {
      const [ref] = await tx
        .select()
        .from(desafios)
        .where(eq(desafios.token_hash, hash(raw)))
      if (!ref) return 'invalido'
      const [u] = await tx
        .select()
        .from(usuarios)
        .where(eq(usuarios.id, ref.usuario_id))
        .for('update')
      const [d] = await tx
        .select()
        .from(desafios)
        .where(eq(desafios.id, ref.id))
        .for('update')
      if (
        !u ||
        u.status !== 'ATIVO' ||
        u.deleted_at ||
        !d ||
        d.used_at ||
        d.expires_at <= new Date()
      )
        return 'invalido'
      const [n] = await tx
        .select({ total: count() })
        .from(envios)
        .where(
          and(
            eq(envios.usuario_id, u.id),
            gt(
              envios.created_at,
              sql`(now() at time zone 'UTC') - interval '15 minutes'`,
            ),
          ),
        )
      if (n.total >= 3) return 'limite'
      const pin = randomInt(1000000).toString().padStart(6, '0')
      await tx
        .update(desafios)
        .set({ pin_hash: null, pin_expires_at: null, pin_enviado: false })
        .where(and(eq(desafios.usuario_id, u.id), isNull(desafios.used_at)))
      await tx
        .update(desafios)
        .set({
          pin_hash: this.pinHash(d.id, pin),
          pin_enviado: false,
          pin_expires_at: new Date(Date.now() + 300000),
        })
        .where(eq(desafios.id, d.id))
      await tx.insert(envios).values({ usuario_id: u.id })
      return { email: u.email, id: d.id, pin, pinHash: this.pinHash(d.id, pin) }
    })
    if (result === 'limite')
      throw new HttpException(
        'Limite de envios atingido. Tente novamente mais tarde.',
        429,
      )
    if (typeof result === 'string') throw invalido()
    try {
      await this.email.enviar({
        para: result.email,
        assunto: 'Alocca Plantões - código de acesso',
        texto: `Seu código de acesso é ${result.pin}. Ele vale por 5 minutos.`,
      })
    } catch {
      await this.db
        .update(desafios)
        .set({ pin_hash: null, pin_expires_at: null, pin_enviado: false })
        .where(
          and(
            eq(desafios.id, result.id),
            eq(desafios.pin_hash, result.pinHash),
          ),
        )
      throw new ServiceUnavailableException('Envio de e-mail indisponível')
    }
    await this.db
      .update(desafios)
      .set({ pin_enviado: true })
      .where(
        and(
          eq(desafios.id, result.id),
          eq(desafios.pin_hash, result.pinHash),
          isNull(desafios.used_at),
        ),
      )
    return { message: 'Código enviado por e-mail.' }
  }
  async validar(raw: string, pin: string) {
    const result = await this.db.transaction(async (tx) => {
      const [ref] = await tx
        .select()
        .from(desafios)
        .where(eq(desafios.token_hash, hash(raw)))
      if (!ref) return null
      const [u] = await tx
        .select()
        .from(usuarios)
        .where(eq(usuarios.id, ref.usuario_id))
        .for('update')
      const [d] = await tx
        .select()
        .from(desafios)
        .where(eq(desafios.id, ref.id))
        .for('update')
      if (
        !u ||
        u.status !== 'ATIVO' ||
        u.deleted_at ||
        !d ||
        d.used_at ||
        d.expires_at <= new Date() ||
        !d.pin_hash ||
        !d.pin_enviado ||
        !d.pin_expires_at ||
        d.pin_expires_at <= new Date()
      )
        return null
      if (
        !timingSafeEqual(
          Buffer.from(d.pin_hash, 'hex'),
          Buffer.from(this.pinHash(d.id, pin), 'hex'),
        )
      ) {
        await tx
          .update(desafios)
          .set({
            erros: d.erros + 1,
            used_at: d.erros + 1 >= 5 ? new Date() : null,
          })
          .where(eq(desafios.id, d.id))
        return null
      }
      await tx
        .update(desafios)
        .set({ used_at: new Date(), pin_hash: null })
        .where(eq(desafios.id, d.id))
      const expires = new Date(Date.now() + 30 * 86400000)
      const [s] = await tx
        .insert(sessoes)
        .values({ usuario_id: u.id, expires_at: expires })
        .returning()
      const next = token()
      await tx
        .insert(refresh)
        .values({ sessao_id: s.id, token_hash: hash(next) })
      return { u, s, next }
    })
    if (!result) throw invalido()
    return this.par(
      result.u.id,
      result.u.versao_sessao,
      result.s.id,
      result.s.expires_at,
      result.next,
      true,
    )
  }
  async renovar(raw: string) {
    const result = await this.db.transaction(async (tx) => {
      const [ref] = await tx
        .select({ r: refresh, s: sessoes })
        .from(refresh)
        .innerJoin(sessoes, eq(refresh.sessao_id, sessoes.id))
        .where(eq(refresh.token_hash, hash(raw)))
      if (!ref) return null
      const [u] = await tx
        .select()
        .from(usuarios)
        .where(eq(usuarios.id, ref.s.usuario_id))
        .for('update')
      const [s] = await tx
        .select()
        .from(sessoes)
        .where(eq(sessoes.id, ref.s.id))
        .for('update')
      const [r] = await tx
        .select()
        .from(refresh)
        .where(eq(refresh.id, ref.r.id))
        .for('update')
      if (!s || s.revoked_at) return null
      if (r.used_at) {
        await tx
          .update(sessoes)
          .set({ revoked_at: new Date() })
          .where(eq(sessoes.id, s.id))
        return null
      }
      if (
        !u ||
        u.status !== 'ATIVO' ||
        u.deleted_at ||
        s.expires_at <= new Date()
      )
        return null
      await tx
        .update(refresh)
        .set({ used_at: new Date() })
        .where(eq(refresh.id, r.id))
      const next = token()
      await tx
        .insert(refresh)
        .values({ sessao_id: s.id, token_hash: hash(next) })
      return { u, s, next }
    })
    if (!result) throw invalido()
    return this.par(
      result.u.id,
      result.u.versao_sessao,
      result.s.id,
      result.s.expires_at,
      result.next,
      true,
    )
  }
  async logout(raw: string) {
    const [ref] = await this.db
      .select({ id: sessoes.id })
      .from(refresh)
      .innerJoin(sessoes, eq(refresh.sessao_id, sessoes.id))
      .where(eq(refresh.token_hash, hash(raw)))
    if (ref)
      await this.db
        .update(sessoes)
        .set({ revoked_at: new Date() })
        .where(and(eq(sessoes.id, ref.id), isNull(sessoes.revoked_at)))
    return { message: 'Sessão encerrada.' }
  }
  private async par(
    id: string,
    versao: number,
    sid: string,
    expires: Date,
    next: string,
    incluirUsuario: boolean,
  ) {
    return {
      access_token: await this.jwt.signAsync({
        sub: id,
        versao_sessao: versao,
        sid,
      }),
      token_type: 'Bearer',
      expires_in: this.config.get('JWT_EXPIRES', { infer: true }),
      refresh_token: next,
      refresh_expires_in: Math.max(
        0,
        Math.floor((expires.getTime() - Date.now()) / 1000),
      ),
      ...(incluirUsuario ? { usuario: await this.usuarios.perfil(id) } : {}),
    }
  }
}
