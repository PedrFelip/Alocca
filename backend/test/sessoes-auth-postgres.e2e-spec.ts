import type { INestApplication } from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'
import { Test } from '@nestjs/testing'
import { drizzle } from 'drizzle-orm/postgres-js'
import { createHash, randomUUID } from 'node:crypto'
import { readFile, readdir } from 'node:fs/promises'
import postgres from 'postgres'
import request from 'supertest'
import { UsuariosService } from '../src/usuarios/usuarios.service.ts'
import { AppModule } from '../src/app.module.ts'
import { hashDoToken } from '../src/auth/recuperacao-senha.service.ts'
import { PasswordService } from '../src/auth/password.service.ts'
import { DRIZZLE_DB } from '../src/db/db.provider.ts'

const adminUrl = process.env.E2E_PG_ADMIN

describe.skipIf(!adminUrl)('Sessões de autenticação em PostgreSQL', () => {
  let admin: postgres.Sql
  let pg: postgres.Sql
  let app: INestApplication
  let nome: string
  let usuario: string
  const senha = 'Senha-Segura-123'

  beforeEach(async () => {
    nome = `auth_${randomUUID().replaceAll('-', '')}`
    admin = postgres(adminUrl!, { max: 1 })
    await admin.unsafe(`CREATE DATABASE ${nome}`)
    const url = new URL(adminUrl!)
    url.pathname = `/${nome}`
    pg = postgres(url.toString(), { max: 1 })
    for (const dir of (await readdir('drizzle')).sort())
      await pg.unsafe(await readFile(`drizzle/${dir}/migration.sql`, 'utf8'))
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(DRIZZLE_DB)
      .useValue(drizzle({ client: pg }))
      .compile()
    app = module.createNestApplication()
    await app.init()
    const hash = await app.get(PasswordService).hash(senha)
    const [row] =
      await pg`INSERT INTO usuarios (nome,email,senha_hash,tipo) VALUES ('Teste','teste@example.com',${hash},'ADMIN') RETURNING id`
    usuario = row.id
  }, 60000)

  afterEach(async () => {
    await app?.close()
    await pg?.end()
    if (admin) {
      await admin.unsafe(`DROP DATABASE IF EXISTS ${nome} WITH (FORCE)`)
      await admin.end()
    }
  })

  async function login() {
    const res = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: 'teste@example.com', senha })
      .expect(200)
    return res.body as {
      access_token: string
      refresh_token: string
      usuario: { id: string }
    }
  }

  it('rotaciona uma única vez sob concorrência e logout revoga access e refresh', async () => {
    const entrada = await login()
    const [row] =
      await pg`SELECT token_hash FROM sessoes_auth WHERE usuario_id = ${usuario}`
    expect(row.token_hash).toBe(
      createHash('sha256').update(entrada.refresh_token).digest('hex'),
    )
    expect(row.token_hash).not.toBe(entrada.refresh_token)
    const tentativas = await Promise.all(
      [1, 2].map(() =>
        request(app.getHttpServer())
          .post('/auth/refresh')
          .send({ refresh_token: entrada.refresh_token }),
      ),
    )
    expect(tentativas.map((r) => r.status).sort((a, b) => a - b)).toEqual([
      200, 401,
    ])
    const renovado = tentativas.find((r) => r.status === 200)!.body
    expect(renovado.usuario.id).toBe(usuario)
    expect(renovado.refresh_token).not.toBe(entrada.refresh_token)
    await request(app.getHttpServer())
      .post('/auth/logout')
      .set('Authorization', `Bearer ${renovado.access_token}`)
      .expect(200)
    await request(app.getHttpServer())
      .post('/auth/logout')
      .set('Authorization', `Bearer ${entrada.access_token}`)
      .expect(401)
    await request(app.getHttpServer())
      .post('/auth/refresh')
      .send({ refresh_token: renovado.refresh_token })
      .expect(401)
  })

  it('recusa refresh expirado e conta inativa ou excluída', async () => {
    const entrada = await login()
    await pg`UPDATE sessoes_auth SET expires_at = now() - interval '1 second' WHERE usuario_id = ${usuario}`
    await request(app.getHttpServer())
      .post('/auth/refresh')
      .send({ refresh_token: entrada.refresh_token })
      .expect(401)
    await pg`UPDATE sessoes_auth SET expires_at = now() + interval '1 day' WHERE usuario_id = ${usuario}`
    await pg`UPDATE usuarios SET status = 'INATIVO' WHERE id = ${usuario}`
    await request(app.getHttpServer())
      .post('/auth/refresh')
      .send({ refresh_token: entrada.refresh_token })
      .expect(401)
    await pg`UPDATE usuarios SET status = 'ATIVO', deleted_at = now() WHERE id = ${usuario}`
    await request(app.getHttpServer())
      .post('/auth/refresh')
      .send({ refresh_token: entrada.refresh_token })
      .expect(401)
  })

  it('aceita JWT legado e permite revogá-lo no logout', async () => {
    const token = await app.get(JwtService).signAsync({ sub: usuario })
    await request(app.getHttpServer())
      .post('/auth/logout')
      .set('Authorization', `Bearer ${token}`)
      .expect(200)
    await request(app.getHttpServer())
      .post('/auth/logout')
      .set('Authorization', `Bearer ${token}`)
      .expect(401)
  })
  it('redefinir senha revoga todas as sessões renováveis da conta', async () => {
    const entrada = await login()
    const legado = await app.get(JwtService).signAsync({ sub: usuario })
    await pg`INSERT INTO tokens_recuperacao_senha (usuario_id,token,expires_at)
      VALUES (${usuario},${hashDoToken('CODIGOTESTE')},now()+interval '15 minutes')`
    await request(app.getHttpServer())
      .post('/auth/redefinir-senha')
      .send({ token: 'CODIGOTESTE', nova_senha: 'Nova-Senha-Segura-456' })
      .expect(200)
    await request(app.getHttpServer())
      .get('/notificacoes')
      .set('Authorization', `Bearer ${entrada.access_token}`)
      .expect(401)
    await request(app.getHttpServer())
      .post('/auth/refresh')
      .send({ refresh_token: entrada.refresh_token })
      .expect(401)
    await request(app.getHttpServer())
      .get('/notificacoes')
      .set('Authorization', `Bearer ${legado}`)
      .expect(401)
  })

  it('login validado com senha antiga não cria sessão depois de reset concorrente', async () => {
    const usuarios = app.get(UsuariosService)
    const registrar = usuarios.registrarLogin.bind(usuarios)
    let continuar!: () => void
    let validou!: () => void
    const pausa = new Promise<void>((r) => {
      continuar = r
    })
    const pronta = new Promise<void>((r) => {
      validou = r
    })
    const spy = vi
      .spyOn(usuarios, 'registrarLogin')
      .mockImplementation(async (id) => {
        const resultado = await registrar(id)
        validou()
        await pausa
        return resultado
      })
    const pendente = request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: 'teste@example.com', senha })
      .then((r) => r)
    await pronta
    try {
      await pg`INSERT INTO tokens_recuperacao_senha (usuario_id,token,expires_at)
        VALUES (${usuario},${hashDoToken('CONCORRENTE')},now()+interval '15 minutes')`
      await request(app.getHttpServer())
        .post('/auth/redefinir-senha')
        .send({ token: 'CONCORRENTE', nova_senha: 'Senha-Atualizada-456' })
        .expect(200)
    } finally {
      continuar()
      spy.mockRestore()
    }
    expect((await pendente).status).toBe(401)
    expect(
      (await pg`SELECT id FROM sessoes_auth WHERE revogado_at IS NULL`).length,
    ).toBe(0)
  })
})
