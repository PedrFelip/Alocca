import 'reflect-metadata'
import {
  ForbiddenException,
  UnauthorizedException,
  type ExecutionContext,
} from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import {
  PERMISSOES_KEY,
  type PermissaoUsuario,
} from './permissoes.decorator.ts'
import { PermissoesGuard } from './permissoes.guard.ts'

describe('PermissoesGuard', () => {
  const guard = new PermissoesGuard(new Reflector())

  function context(
    tipoUsuario?: PermissaoUsuario,
    controllerTipos?: PermissaoUsuario[],
    methodTipos?: PermissaoUsuario[],
  ): ExecutionContext {
    class Controller {}
    function handler() {}
    if (controllerTipos)
      Reflect.defineMetadata(PERMISSOES_KEY, controllerTipos, Controller)
    if (methodTipos)
      Reflect.defineMetadata(PERMISSOES_KEY, methodTipos, handler)
    return {
      getClass: () => Controller,
      getHandler: () => handler,
      switchToHttp: () => ({
        getRequest: () => ({
          usuarioId: tipoUsuario ? 'usuario-id' : undefined,
          tipoUsuario,
        }),
      }),
    } as unknown as ExecutionContext
  }

  it('exige autenticação mesmo sem permissões declaradas', () => {
    expect(() => guard.canActivate(context())).toThrow(UnauthorizedException)
  })

  it('permite usuário autenticado quando não há restrição de papel', () => {
    expect(guard.canActivate(context('MEDICO'))).toBe(true)
  })

  it('bloqueia médicos e gestores nas rotas de administrador', () => {
    for (const tipo of ['MEDICO', 'GESTOR'] as const) {
      expect(() => guard.canActivate(context(tipo, ['ADMIN']))).toThrow(
        ForbiddenException,
      )
    }
    expect(guard.canActivate(context('ADMIN', ['ADMIN']))).toBe(true)
  })

  it('aceita qualquer um dos papéis declarados', () => {
    expect(guard.canActivate(context('GESTOR', ['MEDICO', 'GESTOR']))).toBe(
      true,
    )
  })

  it('a configuração do método substitui a do controller', () => {
    expect(guard.canActivate(context('MEDICO', ['ADMIN'], ['MEDICO']))).toBe(
      true,
    )
    expect(() =>
      guard.canActivate(context('ADMIN', ['ADMIN'], ['MEDICO'])),
    ).toThrow(ForbiddenException)
  })
})
