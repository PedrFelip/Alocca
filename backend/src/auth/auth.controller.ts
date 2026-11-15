import {
  Body,
  Controller,
  HttpCode,
  Inject,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common'
import { Throttle } from '@nestjs/throttler'
import { ZodValidationPipe } from '../common/zod-validation.pipe.ts'
import {
  cadastroMedicoSchema,
  type CadastroMedico,
} from '../usuarios/usuarios.schemas.ts'
import { UsuariosService } from '../usuarios/usuarios.service.ts'
import {
  alterarSenhaSchema,
  type AlterarSenha,
  loginSchema,
  recuperarSenhaSchema,
  redefinirSenhaSchema,
  type Login,
  type RecuperarSenha,
  type RedefinirSenha,
} from './auth.schemas.ts'
import { AuthGuard, type AuthenticatedRequest } from './auth.guard.ts'
import {
  challengeSchema,
  validarPinSchema,
  refreshSchema,
} from './auth.schemas.ts'
import { SessaoMobileService } from './sessao-mobile.service.ts'
import { AuthService } from './auth.service.ts'
import { RecuperacaoSenhaService } from './recuperacao-senha.service.ts'

@Controller('auth')
@Throttle({ default: { limit: 10, ttl: 60000 } })
export class AuthController {
  constructor(
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(SessaoMobileService) private readonly mobile: SessaoMobileService,
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

  @Post('login/medico')
  @HttpCode(200)
  loginMedico(@Body(new ZodValidationPipe(loginSchema)) data: Login) {
    return this.mobile.login(data, 'MEDICO')
  }
  @Post('login/gestor')
  @HttpCode(200)
  loginGestor(@Body(new ZodValidationPipe(loginSchema)) data: Login) {
    return this.mobile.login(data, 'GESTOR')
  }
  @Post('2fa/solicitar-pin')
  @HttpCode(200)
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  solicitarPin(
    @Body(new ZodValidationPipe(challengeSchema)) data: {
      challenge_token: string
    },
  ) {
    return this.mobile.solicitar(data.challenge_token)
  }
  @Post('2fa/validar-pin')
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  validarPin(
    @Body(new ZodValidationPipe(validarPinSchema)) data: {
      challenge_token: string
      pin_code: string
    },
  ) {
    return this.mobile.validar(data.challenge_token, data.pin_code)
  }
  @Post('refresh')
  @HttpCode(200)
  renovar(
    @Body(new ZodValidationPipe(refreshSchema)) data: { refresh_token: string },
  ) {
    return this.mobile.renovar(data.refresh_token)
  }
  @Post('logout')
  @HttpCode(200)
  logout(
    @Body(new ZodValidationPipe(refreshSchema)) data: { refresh_token: string },
  ) {
    return this.mobile.logout(data.refresh_token)
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

  @Post('alterar-senha')
  @HttpCode(200)
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @UseGuards(AuthGuard)
  alterarSenha(
    @Req() request: AuthenticatedRequest,
    @Body(new ZodValidationPipe(alterarSenhaSchema)) data: AlterarSenha,
  ) {
    return this.recuperacao.alterar(
      request.usuarioId,
      request.versaoSessao,
      data,
    )
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
