import {
  Body,
  Controller,
  Get,
  Inject,
  Patch,
  Req,
  UseGuards,
} from '@nestjs/common'
import { AuthGuard, type AuthenticatedRequest } from '../auth/auth.guard.js'
import { ZodValidationPipe } from '../common/zod-validation.pipe.js'
import {
  atualizarUsuarioSchema,
  type AtualizarUsuario,
} from './usuarios.schemas.js'
import { UsuariosService } from './usuarios.service.js'

@Controller('usuarios')
@UseGuards(AuthGuard)
export class UsuariosController {
  constructor(
    @Inject(UsuariosService) private readonly usuarios: UsuariosService,
  ) {}

  @Get('me')
  perfil(@Req() request: AuthenticatedRequest) {
    return this.usuarios.perfil(request.usuarioId)
  }

  @Patch('me')
  atualizar(
    @Req() request: AuthenticatedRequest,
    @Body(new ZodValidationPipe(atualizarUsuarioSchema)) data: AtualizarUsuario,
  ) {
    return this.usuarios.atualizarPerfil(request.usuarioId, data)
  }
}
