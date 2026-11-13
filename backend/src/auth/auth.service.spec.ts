import { HttpException, Logger, UnauthorizedException } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import type { JwtService } from '@nestjs/jwt'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Env } from '../config/env.ts'
import type { Usuario, UsuariosService } from '../usuarios/usuarios.service.ts'
import { AuthService } from './auth.service.ts'
import { PasswordService } from './password.service.ts'

function criarUsuarioBase(overrides: Partial<Usuario> = {}): Usuario {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    nome: 'Dra. Maria',
    cpf: '52998224725',
    email: 'maria.segredo@example.com',
    senha_hash: 'scrypt:salt:hash-super-secreto',
    telefone: null,
    tipo: 'MEDICO',
    status: 'ATIVO',
    tentativas_falhas: 0,
    bloqueado_ate: null,
    ultimo_login_at: null,
    created_at: new Date(),
    updated_at: new Date(),
    deleted_at: null,
    ...overrides,
  }
}

describe('AuthService (logs de login falho)', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  function criarServico(usuariosOverrides: Partial<UsuariosService> = {}) {
    const usuarios = {
      buscarCredenciais: vi.fn(),
      bloqueioLoginAtivo: vi.fn().mockResolvedValue(false),
      registrarFalhaLogin: vi.fn().mockResolvedValue({
        tentativas_falhas: 1,
        bloqueado_ate: null,
      }),
      registrarLogin: vi.fn().mockResolvedValue(true),
      perfil: vi.fn().mockResolvedValue({ id: '11111111-1111-4111-8111-111111111111' }),
      ...usuariosOverrides,
    } as unknown as UsuariosService

    const passwords = new PasswordService()
    const jwt = {
      signAsync: vi.fn().mockResolvedValue('jwt.token.secreto'),
    } as unknown as JwtService
    const config = new ConfigService<Env, true>({
      JWT_EXPIRES: '900',
    })

    return {
      auth: new AuthService(usuarios, passwords, jwt, config),
      passwords,
      usuarios,
    }
  }

  function capturarLogsWarn() {
    return vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => {})
  }

  function verificarSemDadosSensiveis(
    mensagem: string,
    segredos: string[],
  ): void {
    for (const segredo of segredos) {
      expect(mensagem).not.toContain(segredo)
    }
  }

  it('gera log estruturado para e-mail inexistente sem vazar senha ou e-mail completo', async () => {
    const warnSpy = capturarLogsWarn()
    const { auth } = criarServico({
      buscarCredenciais: vi.fn().mockResolvedValue(undefined),
    })
    const email = 'inexistente.sigiloso@example.com'
    const senha = 'Senha-Super-Secreta-123'

    await expect(auth.login({ email, senha })).rejects.toThrow(
      UnauthorizedException,
    )

    expect(warnSpy).toHaveBeenCalledTimes(1)
    const mensagem = String(warnSpy.mock.calls[0][0])
    verificarSemDadosSensiveis(mensagem, [email, senha])
    expect(JSON.parse(mensagem)).toEqual({
      evento: 'LOGIN_FALHO',
      motivo: 'EMAIL_INEXISTENTE',
      usuario_id: null,
      email_mascarado: 'i***@example.com',
    })
  })

  it('gera log estruturado para senha incorreta sem vazar senha ou hash', async () => {
    const warnSpy = capturarLogsWarn()
    const passwords = new PasswordService()
    const hashCorreto = await passwords.hash('Senha-Correta-123')
    const usuario = criarUsuarioBase({ senha_hash: hashCorreto })
    const { auth } = criarServico({
      buscarCredenciais: vi.fn().mockResolvedValue(usuario),
      registrarFalhaLogin: vi.fn().mockResolvedValue({
        tentativas_falhas: 2,
        bloqueado_ate: null,
      }),
    })
    const senhaErrada = 'Senha-Errada-999'

    await expect(
      auth.login({ email: usuario.email, senha: senhaErrada }),
    ).rejects.toThrow(UnauthorizedException)

    expect(warnSpy).toHaveBeenCalledTimes(1)
    const mensagem = String(warnSpy.mock.calls[0][0])
    verificarSemDadosSensiveis(mensagem, [
      usuario.email,
      senhaErrada,
      hashCorreto,
    ])
    expect(JSON.parse(mensagem)).toEqual({
      evento: 'LOGIN_FALHO',
      motivo: 'SENHA_INCORRETA',
      usuario_id: usuario.id,
      email_mascarado: 'm***@example.com',
      tentativas_falhas: 2,
    })
  })

  it('gera log estruturado quando a 5ª falha ativa o bloqueio por RN08', async () => {
    const warnSpy = capturarLogsWarn()
    const passwords = new PasswordService()
    const hashCorreto = await passwords.hash('Senha-Correta-123')
    const usuario = criarUsuarioBase({ senha_hash: hashCorreto })
    const { auth } = criarServico({
      buscarCredenciais: vi.fn().mockResolvedValue(usuario),
      registrarFalhaLogin: vi.fn().mockResolvedValue({
        tentativas_falhas: 5,
        bloqueado_ate: new Date(Date.now() + 15 * 60_000),
      }),
    })
    const senhaErrada = 'Senha-Errada-RN08'

    await expect(
      auth.login({ email: usuario.email, senha: senhaErrada }),
    ).rejects.toThrow(HttpException)

    expect(warnSpy).toHaveBeenCalledTimes(1)
    const mensagem = String(warnSpy.mock.calls[0][0])
    verificarSemDadosSensiveis(mensagem, [
      usuario.email,
      senhaErrada,
      hashCorreto,
    ])
    expect(JSON.parse(mensagem)).toEqual({
      evento: 'LOGIN_FALHO',
      motivo: 'CONTA_BLOQUEADA_RN08',
      usuario_id: usuario.id,
      email_mascarado: 'm***@example.com',
      tentativas_falhas: 5,
    })
  })

  it('gera log estruturado quando a conta já está bloqueada por RN08', async () => {
    const warnSpy = capturarLogsWarn()
    const usuario = criarUsuarioBase()
    const { auth } = criarServico({
      buscarCredenciais: vi.fn().mockResolvedValue(usuario),
      bloqueioLoginAtivo: vi.fn().mockResolvedValue(true),
    })
    const senha = 'Qualquer-Senha-123'

    await expect(auth.login({ email: usuario.email, senha })).rejects.toThrow(
      HttpException,
    )

    expect(warnSpy).toHaveBeenCalledTimes(1)
    const mensagem = String(warnSpy.mock.calls[0][0])
    verificarSemDadosSensiveis(mensagem, [
      usuario.email,
      senha,
      usuario.senha_hash,
    ])
    expect(JSON.parse(mensagem)).toEqual({
      evento: 'LOGIN_FALHO',
      motivo: 'CONTA_BLOQUEADA_RN08',
      usuario_id: usuario.id,
      email_mascarado: 'm***@example.com',
    })
  })

  it('gera log estruturado quando a conta está inativa ou bloqueada administrativamente', async () => {
    const warnSpy = capturarLogsWarn()
    const passwords = new PasswordService()
    const senhaCorreta = 'Senha-Correta-123'
    const hashCorreto = await passwords.hash(senhaCorreta)
    const usuario = criarUsuarioBase({
      senha_hash: hashCorreto,
      status: 'INATIVO',
    })
    const { auth } = criarServico({
      buscarCredenciais: vi.fn().mockResolvedValue(usuario),
    })

    await expect(
      auth.login({ email: usuario.email, senha: senhaCorreta }),
    ).rejects.toThrow(UnauthorizedException)

    expect(warnSpy).toHaveBeenCalledTimes(1)
    const mensagem = String(warnSpy.mock.calls[0][0])
    verificarSemDadosSensiveis(mensagem, [
      usuario.email,
      senhaCorreta,
      hashCorreto,
    ])
    expect(JSON.parse(mensagem)).toEqual({
      evento: 'LOGIN_FALHO',
      motivo: 'USUARIO_INATIVO',
      usuario_id: usuario.id,
      email_mascarado: 'm***@example.com',
    })
  })

  it('não emite log de falha quando o login é bem-sucedido', async () => {
    const warnSpy = capturarLogsWarn()
    const passwords = new PasswordService()
    const senhaCorreta = 'Senha-Correta-123'
    const hashCorreto = await passwords.hash(senhaCorreta)
    const usuario = criarUsuarioBase({ senha_hash: hashCorreto })
    const { auth } = criarServico({
      buscarCredenciais: vi.fn().mockResolvedValue(usuario),
    })

    const resultado = await auth.login({
      email: usuario.email,
      senha: senhaCorreta,
    })

    expect(resultado.access_token).toBe('jwt.token.secreto')
    expect(warnSpy).not.toHaveBeenCalled()
  })
})
