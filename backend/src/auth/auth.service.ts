import {
  HttpException,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { JwtService } from '@nestjs/jwt'
import type { Env } from '../config/env.ts'
import { UsuariosService } from '../usuarios/usuarios.service.ts'
import type { Login } from './auth.schemas.ts'
import { PasswordService } from './password.service.ts'

@Injectable()
export class AuthService {
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
      throw new HttpException(
        'Conta bloqueada temporariamente. Tente novamente em 15 minutos.',
        429,
      )
    }
    const valid = await this.passwords.verify(
      data.senha,
      usuario?.senha_hash ?? (await this.dummyHash),
    )
    if (!usuario || !valid || usuario.status !== 'ATIVO') {
      if (usuario && !valid) {
        const tentativa = await this.usuarios.registrarFalhaLogin(usuario.id)
        if (tentativa?.bloqueado_ate) {
          throw new HttpException(
            'Conta bloqueada temporariamente. Tente novamente em 15 minutos.',
            429,
          )
        }
      }
      throw new UnauthorizedException('E-mail, CPF, CRM ou senha incorretos.')
    }
    if (!(await this.usuarios.registrarLogin(usuario.id))) {
      throw new HttpException(
        'Conta bloqueada temporariamente. Tente novamente em 15 minutos.',
        429,
      )
    }
    return {
      access_token: await this.jwt.signAsync({ sub: usuario.id }),
      token_type: 'Bearer',
      expires_in: this.config.get('JWT_EXPIRES', { infer: true }),
      usuario: await this.usuarios.perfil(usuario.id),
    }
  }
}
