import { Body, Controller, HttpCode, Inject, Post } from '@nestjs/common'
import { Throttle } from '@nestjs/throttler'
import { ZodValidationPipe } from '../common/zod-validation.pipe.js'
import {
  cadastroMedicoSchema,
  type CadastroMedico,
} from '../usuarios/usuarios.schemas.js'
import { UsuariosService } from '../usuarios/usuarios.service.js'
import { loginSchema, type Login } from './auth.schemas.js'
import { AuthService } from './auth.service.js'

@Controller('auth')
@Throttle({ default: { limit: 10, ttl: 60000 } })
export class AuthController {
  constructor(
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(UsuariosService) private readonly usuarios: UsuariosService,
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
}
