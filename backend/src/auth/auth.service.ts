import { Inject, Injectable, UnauthorizedException } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { JwtService } from '@nestjs/jwt'
import type { Env } from '../config/env.js'
import { UsuariosService } from '../usuarios/usuarios.service.js'
import type { Login } from './auth.schemas.js'
import { PasswordService } from './password.service.js'

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
    const valid = await this.passwords.verify(
      data.senha,
      usuario?.senha_hash ?? (await this.dummyHash),
    )
    if (!usuario || !valid || usuario.status !== 'ATIVO') {
      throw new UnauthorizedException('E-mail ou senha inválidos')
    }
    await this.usuarios.registrarLogin(usuario.id)
    return {
      access_token: await this.jwt.signAsync({ sub: usuario.id }),
      token_type: 'Bearer',
      expires_in: this.config.get('JWT_EXPIRES', { infer: true }),
      usuario: await this.usuarios.perfil(usuario.id),
    }
  }
}
