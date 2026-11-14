import { Body, Controller, HttpCode, Inject, Post } from '@nestjs/common'
import { Throttle } from '@nestjs/throttler'
import { ZodValidationPipe } from '../common/zod-validation.pipe.ts'
import {
  cadastroMedicoSchema,
  type CadastroMedico,
} from '../usuarios/usuarios.schemas.ts'
import { UsuariosService } from '../usuarios/usuarios.service.ts'
import {
  loginSchema,
  recuperarSenhaSchema,
  redefinirSenhaSchema,
  type Login,
  type RecuperarSenha,
  type RedefinirSenha,
} from './auth.schemas.ts'
import { AuthService } from './auth.service.ts'
import { RecuperacaoSenhaService } from './recuperacao-senha.service.ts'

@Controller('auth')
@Throttle({ default: { limit: 10, ttl: 60000 } })
export class AuthController {
  constructor(
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(UsuariosService) private readonly usuarios: UsuariosService,
    @Inject(RecuperacaoSenhaService)
    private readonly recuperacao: RecuperacaoSenhaService,
  ) {}

  @Post('register/medico')
  cadastrarMedico(
    @Body(new ZodValidationPipe(cadastroMedicoSchema)) data: CadastroMedico,
  ) {
    return this.usuarios.cadastrarMedico(data)
  }

  @Post('login')
  @HttpCode(200)
  login(@Body(new ZodValidationPipe(loginSchema)) data: Login) {
    return this.auth.login(data)
  }

  // UC04: limite menor pra ninguem ficar disparando e-mail
  @Post('recuperar-senha')
  @HttpCode(200)
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  recuperarSenha(
    @Body(new ZodValidationPipe(recuperarSenhaSchema)) data: RecuperarSenha,
  ) {
    return this.recuperacao.solicitar(data)
  }

  @Post('redefinir-senha')
  @HttpCode(200)
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  redefinirSenha(
    @Body(new ZodValidationPipe(redefinirSenhaSchema)) data: RedefinirSenha,
  ) {
    return this.recuperacao.redefinir(data)
  }
}
