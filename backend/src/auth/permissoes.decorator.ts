import { SetMetadata } from '@nestjs/common'
import type { AuthenticatedRequest } from './auth.guard.ts'

export const PERMISSOES_KEY = 'auth:permissoes'
export type PermissaoUsuario = AuthenticatedRequest['tipoUsuario']

export function Permissoes(
  ...tipos: [PermissaoUsuario, ...PermissaoUsuario[]]
): ReturnType<typeof SetMetadata> {
  return SetMetadata(PERMISSOES_KEY, tipos)
}
