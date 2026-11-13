import {
  HttpException,
  Inject,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common'
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
          throw new HttpException(
            'Conta bloqueada temporariamente. Tente novamente em 15 minutos.',
            429,
          )
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
    return {
      access_token: await this.jwt.signAsync({ sub: usuario.id }),
      token_type: 'Bearer',
      expires_in: this.config.get('JWT_EXPIRES', { infer: true }),
      usuario: await this.usuarios.perfil(usuario.id),
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
