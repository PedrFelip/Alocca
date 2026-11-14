import type { usuariosTable } from '../db/schemas/usuarios.ts'

type Usuario = typeof usuariosTable.$inferSelect
export type UsuarioPublico = Pick<
  Usuario,
  | 'id'
  | 'nome'
  | 'cpf'
  | 'email'
  | 'telefone'
  | 'tipo'
  | 'status'
  | 'ultimo_login_at'
  | 'created_at'
  | 'updated_at'
>

export function usuarioPublico(usuario: Usuario): UsuarioPublico {
  return {
    id: usuario.id,
    nome: usuario.nome,
    cpf: usuario.cpf,
    email: usuario.email,
    telefone: usuario.telefone,
    tipo: usuario.tipo,
    status: usuario.status,
    ultimo_login_at: usuario.ultimo_login_at,
    created_at: usuario.created_at,
    updated_at: usuario.updated_at,
  }
}
