import { PGlite } from '@electric-sql/pglite'
import { type INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import { JwtService } from '@nestjs/jwt'
import { drizzle } from 'drizzle-orm/pglite'
import { readFile } from 'node:fs/promises'
import request from 'supertest'
import { AppModule } from '../src/app.module.ts'
import { DRIZZLE_DB } from '../src/db/db.provider.ts'
import type { Database } from '../src/db/db.provider.ts'
import { ConfigService } from '@nestjs/config'
import type { Env } from '../src/config/env.ts'
import { AdminBootstrapService } from '../src/auth/admin-bootstrap.service.ts'
import { AuthService } from '../src/auth/auth.service.ts'
import { PasswordService } from '../src/auth/password.service.ts'

const cadastro = {
  nome: 'Dra. Maria',
  cpf: '529.982.247-25',
  email: 'Maria@Example.com',
  senha: 'Senha-Segura-123',
  crm: '123456',
  uf_crm: 'sp',
  especialidade: 'Clínica médica',
}

describe('Autenticação e usuários (PostgreSQL)', () => {
  let app: INestApplication
  let database: PGlite

  beforeAll(async () => {
    database = new PGlite()
    await database.exec(
      await readFile(
        'drizzle/20260917114458_peaceful_frog_thor/migration.sql',
        'utf8',
      ),
    )
    await database.exec(
      "INSERT INTO usuarios (nome, email, senha_hash, tipo) VALUES ('Legado', 'Legado@Example.com', 'hash', 'admin')",
    )
    await database.exec(
      await readFile(
        'drizzle/20261009191003_classy_paper_doll/migration.sql',
        'utf8',
      ),
    )
    await database.exec(
      await readFile(
        'drizzle/20261009213113_amused_nextwave/migration.sql',
        'utf8',
      ),
    )
    await database.exec(
      await readFile(
        'drizzle/20261019230000_login_lockout/migration.sql',
        'utf8',
      ),
    )
    await database.exec(
      await readFile(
        'drizzle/20261026133738_rainy_liz_osborn/migration.sql',
        'utf8',
      ),
    )
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(DRIZZLE_DB)
      .useValue(drizzle({ client: database }))
      .compile()
    app = module.createNestApplication()
    await app.init()
  }, 30000)

  afterAll(async () => {
    await app?.close()
    await database?.close()
  })

  it('migra o usuário existente sem recriar a tabela', async () => {
    const result = await database.query<{
      tipo: string
      status: string
      email: string
    }>('SELECT tipo, status, email FROM usuarios')
    expect(result.rows[0]).toEqual({
      tipo: 'ADMIN',
      status: 'ATIVO',
      email: 'legado@example.com',
    })
  })

  it('rejeita campos inválidos, senha fora da RN05 e CPF inválido', async () => {
    await request(app.getHttpServer())
      .post('/auth/register/medico')
      .send({ ...cadastro, tipo: 'ADMIN' })
      .expect(400)
    await request(app.getHttpServer())
      .post('/auth/register/medico')
      .send({ ...cadastro, uf_crm: 'XX' })
      .expect(400)
    // Amostras via HTTP; variações completas em usuarios.schemas.spec.ts.
    await request(app.getHttpServer())
      .post('/auth/register/medico')
      .send({ ...cadastro, senha: 'sem-maiuscula-1' })
      .expect(400)
    await request(app.getHttpServer())
      .post('/auth/register/medico')
      .send({ ...cadastro, cpf: '111.111.111-11' })
      .expect(400)
  })

  it('cadastra médico e usuário, normaliza dados e protege o hash', async () => {
    const response = await request(app.getHttpServer())
      .post('/auth/register/medico')
      .send(cadastro)
      .expect(201)
    expect(response.body).toMatchObject({
      tipo: 'MEDICO',
      status: 'ATIVO',
      cpf: '52998224725',
      email: 'maria@example.com',
      medico: { crm: '123456', uf_crm: 'SP' },
    })
    expect(response.body).not.toHaveProperty('senha_hash')
    const result = await database.query<{ senha_hash: string }>(
      "SELECT cpf, senha_hash FROM usuarios WHERE email = 'maria@example.com'",
    )
    expect(result.rows[0].cpf).toBe('52998224725')
    expect(result.rows[0].senha_hash).toMatch(/^scrypt:/)
    expect(result.rows[0].senha_hash).not.toContain(cadastro.senha)
  })

  it('retorna MSG-02 para duplicidade de email/CPF/CRM e desfaz a criação do usuário', async () => {
    const mensagemMSG02 =
      'Este dado (E-mail/CPF/CRM) já pertence a uma conta ativa.'
    for (const corpo of [
      cadastro, // e-mail duplicado
      { ...cadastro, email: 'outro@example.com' }, // CPF duplicado
      {
        ...cadastro,
        email: 'outro@example.com',
        cpf: '111.444.777-35',
      }, // CRM/UF duplicado
    ]) {
      const response = await request(app.getHttpServer())
        .post('/auth/register/medico')
        .send(corpo)
        .expect(409)
      expect(response.body.message).toBe(mensagemMSG02)
    }
    const result = await database.query(
      "SELECT id FROM usuarios WHERE email IN ('outro@example.com', 'mais@example.com')",
    )
    expect(result.rows).toHaveLength(0)
  })

  it('retorna erro genérico para credenciais erradas ou inexistentes', async () => {
    const wrong = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: cadastro.email, senha: 'incorreta' })
      .expect(401)
    const missing = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: 'missing@example.com', senha: 'incorreta' })
      .expect(401)
    expect(wrong.body.message).toBe(missing.body.message)
  })

  it('aplica RN08 em cinco falhas, mantém bloqueio e permite login após expiração', async () => {
    const account = {
      ...cadastro,
      nome: 'Dra. Bloqueio',
      cpf: '123.456.789-09',
      email: 'bloqueio@example.com',
      crm: '654321',
    }
    await request(app.getHttpServer())
      .post('/auth/register/medico')
      .send(account)
      .expect(201)

    const auth = app.get(AuthService)
    const attempt = async (senha: string) => {
      try {
        await auth.login({ email: account.email, senha })
        return 200
      } catch (error) {
        return error instanceof Error && 'getStatus' in error
          ? (error as { getStatus: () => number }).getStatus()
          : 500
      }
    }

    expect(await attempt('errada')).toBe(401)
    expect(await attempt('errada')).toBe(401)
    expect(await attempt('errada')).toBe(401)
    expect(await attempt('errada')).toBe(401)
    expect(await attempt('errada')).toBe(429)
    const blocked = await database.query<{
      tentativas_falhas: number
      bloqueado_ate: Date
    }>(
      "SELECT tentativas_falhas, bloqueado_ate FROM usuarios WHERE email = 'bloqueio@example.com'",
    )
    expect(blocked.rows[0].tentativas_falhas).toBe(5)
    expect(blocked.rows[0].bloqueado_ate.getTime()).toBeGreaterThan(Date.now())

    expect(await attempt(account.senha)).toBe(429)
    await database.exec(
      "UPDATE usuarios SET bloqueado_ate = now() - interval '1 second' WHERE email = 'bloqueio@example.com'",
    )
    expect(await attempt('errada')).toBe(401)
    const afterExpiry = await database.query<{
      tentativas_falhas: number
      bloqueado_ate: Date | null
    }>(
      "SELECT tentativas_falhas, bloqueado_ate FROM usuarios WHERE email = 'bloqueio@example.com'",
    )
    expect(afterExpiry.rows[0]).toMatchObject({
      tentativas_falhas: 1,
      bloqueado_ate: null,
    })

    expect(await attempt(account.senha)).toBe(200)
    const afterSuccess = await database.query<{
      tentativas_falhas: number
      bloqueado_ate: Date | null
    }>(
      "SELECT tentativas_falhas, bloqueado_ate FROM usuarios WHERE email = 'bloqueio@example.com'",
    )
    expect(afterSuccess.rows[0]).toMatchObject({
      tentativas_falhas: 0,
      bloqueado_ate: null,
    })

    const concurrentAttempts = await Promise.all(
      Array.from({ length: 5 }, () => attempt('errada')),
    )
    expect(concurrentAttempts.sort((a, b) => a - b)).toEqual([
      401, 401, 401, 401, 429,
    ])
    const afterConcurrentFailures = await database.query<{
      tentativas_falhas: number
    }>(
      "SELECT tentativas_falhas FROM usuarios WHERE email = 'bloqueio@example.com'",
    )
    expect(afterConcurrentFailures.rows[0].tentativas_falhas).toBe(5)
  })

  it('exige token válido para consultar perfil', async () => {
    await request(app.getHttpServer()).get('/usuarios/me').expect(401)
    await request(app.getHttpServer())
      .get('/usuarios/me')
      .set('Authorization', 'Bearer invalid')
      .expect(401)
    const expired = await app
      .get(JwtService)
      .signAsync(
        { sub: '00000000-0000-4000-8000-000000000000' },
        { expiresIn: -1 },
      )
    await request(app.getHttpServer())
      .get('/usuarios/me')
      .set('Authorization', `Bearer ${expired}`)
      .expect(401)
  })

  it('autentica, atualiza último login e permite editar apenas o próprio perfil', async () => {
    const login = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: cadastro.email, senha: cadastro.senha })
      .expect(200)
    expect(login.body.usuario.ultimo_login_at).toBeTruthy()
    expect(login.body.usuario).not.toHaveProperty('senha_hash')
    const bearer = `Bearer ${login.body.access_token}`
    await request(app.getHttpServer())
      .get('/usuarios/me')
      .set('Authorization', bearer)
      .expect(200)
    await request(app.getHttpServer())
      .patch('/usuarios/me')
      .set('Authorization', bearer)
      .send({ status: 'BLOQUEADO' })
      .expect(400)
    const updated = await request(app.getHttpServer())
      .patch('/usuarios/me')
      .set('Authorization', bearer)
      .send({ nome: 'Dra. Maria Silva', especialidade: 'Cardiologia' })
      .expect(200)
    expect(updated.body).toMatchObject({
      nome: 'Dra. Maria Silva',
      medico: { especialidade: 'Cardiologia' },
    })
    await database.exec(
      "UPDATE usuarios SET status = 'BLOQUEADO' WHERE email = 'maria@example.com'",
    )
    await request(app.getHttpServer())
      .get('/usuarios/me')
      .set('Authorization', bearer)
      .expect(401)
    await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: cadastro.email, senha: cadastro.senha })
      .expect(401)
    await database.exec(
      "UPDATE usuarios SET status = 'INATIVO' WHERE email = 'maria@example.com'",
    )
    await request(app.getHttpServer())
      .get('/usuarios/me')
      .set('Authorization', bearer)
      .expect(401)
    await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: cadastro.email, senha: cadastro.senha })
      .expect(401)
    await database.exec(
      "UPDATE usuarios SET status = 'ATIVO', deleted_at = now() WHERE email = 'maria@example.com'",
    )
    await request(app.getHttpServer())
      .get('/usuarios/me')
      .set('Authorization', bearer)
      .expect(401)
    await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: cadastro.email, senha: cadastro.senha })
      .expect(401)
  })

  it('limita tentativas de login', async () => {
    let status = 0
    for (let attempt = 0; attempt < 11; attempt++) {
      const response = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: 'missing@example.com', senha: 'incorreta' })
      status = response.status
      if (status === 429) break
    }
    expect(status).toBe(429)
  })

  it('cria admin inicial sem duplicar, redefinir senha ou promover outra conta', async () => {
    const config = new ConfigService<Env, true>({
      ADMIN_EMAIL: 'bootstrap@example.com',
      ADMIN_PASSWORD: 'admin-inicial-123',
    })
    const bootstrap = new AdminBootstrapService(
      app.get<Database>(DRIZZLE_DB),
      config,
      app.get(PasswordService),
    )
    await bootstrap.onModuleInit()
    const result = await database.query<{ tipo: string; senha_hash: string }>(
      "SELECT tipo, senha_hash FROM usuarios WHERE email = 'bootstrap@example.com'",
    )
    expect(result.rows[0].tipo).toBe('ADMIN')
    expect(
      await app
        .get(PasswordService)
        .verify('admin-inicial-123', result.rows[0].senha_hash),
    ).toBe(true)
    config.set('ADMIN_PASSWORD', 'nova-senha-123')
    await bootstrap.onModuleInit()
    const unchanged = await database.query<{ senha_hash: string }>(
      "SELECT senha_hash FROM usuarios WHERE email = 'bootstrap@example.com'",
    )
    expect(unchanged.rows).toEqual([{ senha_hash: result.rows[0].senha_hash }])
    await database.exec(
      "UPDATE usuarios SET tipo = 'MEDICO', status = 'BLOQUEADO' WHERE email = 'bootstrap@example.com'",
    )
    await bootstrap.onModuleInit()
    const preserved = await database.query<{ tipo: string; status: string }>(
      "SELECT tipo, status FROM usuarios WHERE email = 'bootstrap@example.com'",
    )
    expect(preserved.rows).toEqual([{ tipo: 'MEDICO', status: 'BLOQUEADO' }])
  })
})
