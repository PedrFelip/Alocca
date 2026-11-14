import { drizzle } from 'drizzle-orm/postgres-js'
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import postgres from 'postgres'
import { PasswordService } from '../src/auth/password.service.ts'
import {
  hashDoToken,
  RecuperacaoSenhaService,
} from '../src/auth/recuperacao-senha.service.ts'

const adminUrl =
  process.env.E2E_PG_ADMIN ??
  'postgresql://postgres:postgres@127.0.0.1:5432/postgres'
let disponivel = false
const sonda = postgres(adminUrl, { max: 1, connect_timeout: 3 })
try {
  await sonda`select 1`
  disponivel = true
} catch {
  // CI pode fornecer PostgreSQL; PGlite não testa conexões independentes.
} finally {
  await sonda.end()
}

;(disponivel ? describe : describe.skip)(
  'Senha: concorrência no PostgreSQL',
  () => {
    const nome = `alocca_senha_${Date.now().toString(36)}`
    const url = adminUrl.replace(/\/postgres$/, `/${nome}`)
    let admin: postgres.Sql
    let banco: postgres.Sql
    const conexoes: postgres.Sql[] = []
    const passwords = new PasswordService()
    let usuarioId: string
    function servico() {
      const conexao = postgres(url, { max: 1 })
      conexoes.push(conexao)
      return new RecuperacaoSenhaService(
        drizzle({ client: conexao as never }),
        undefined as never,
        passwords,
        undefined as never,
      )
    }
    beforeAll(async () => {
      admin = postgres(adminUrl, { max: 1 })
      await admin.unsafe(`CREATE DATABASE ${nome}`)
      banco = postgres(url, { max: 2 })
      await migrate(drizzle({ client: banco as never }), {
        migrationsFolder: 'drizzle',
      })
    }, 60000)
    afterAll(async () => {
      await Promise.all(conexoes.map((c) => c.end()))
      await banco?.end()
      if (admin) {
        await admin.unsafe(`DROP DATABASE IF EXISTS ${nome}`)
        await admin.end()
      }
    })
    beforeEach(async () => {
      await banco`TRUNCATE tokens_recuperacao_senha, usuarios CASCADE`
      const hash = await passwords.hash('Senha-Antiga-123')
      const [usuario] =
        await banco`INSERT INTO usuarios (nome, email, senha_hash, tipo) VALUES ('Teste', 'teste@example.com', ${hash}, 'ADMIN') RETURNING id`
      usuarioId = usuario.id
      await banco`INSERT INTO tokens_recuperacao_senha (usuario_id, token, expires_at) VALUES (${usuarioId}, ${hashDoToken('CODIGO')}, now() + interval '15 minutes')`
    })
    it('serializa alteração e recuperação, permitindo somente uma troca', async () => {
      const resultados = await Promise.allSettled([
        servico().alterar(usuarioId, 0, {
          senha_atual: 'Senha-Antiga-123',
          nova_senha: 'Senha-Nova-456',
        }),
        servico().redefinir({ token: 'CODIGO', nova_senha: 'Outra-Senha-789' }),
      ])
      expect(resultados.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
      const [usuario] =
        await banco`SELECT versao_sessao FROM usuarios WHERE id = ${usuarioId}`
      expect(usuario.versao_sessao).toBe(1)
      const pendentes =
        await banco`SELECT id FROM tokens_recuperacao_senha WHERE used_at IS NULL`
      expect(pendentes).toHaveLength(0)
    })
  },
)
