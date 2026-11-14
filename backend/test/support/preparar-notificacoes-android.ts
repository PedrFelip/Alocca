// Fixture isolada e descartável para QA Android. Nunca usa DATABASE_URL.
import { readFile, readdir, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import postgres from 'postgres'
import { PasswordService } from '../../src/auth/password.service.ts'

const adminUrl = process.env.E2E_PG_ADMIN
if (!adminUrl) throw new Error('Informe E2E_PG_ADMIN do Docker de teste')
const admin = postgres(adminUrl, { max: 1 })
const nome = `alocca_android_${randomUUID().replaceAll('-', '')}`
const url = new URL(adminUrl)
url.pathname = `/${nome}`
await admin.unsafe(`CREATE DATABASE ${nome}`)
const pg = postgres(url.toString(), { max: 1 })
let pronto = false
try {
  for (const dir of (await readdir('drizzle')).sort())
    await pg.unsafe(await readFile(`drizzle/${dir}/migration.sql`, 'utf8'))
  const hash = await new PasswordService().hash('Senha-Teste-123')
  const [u] = await pg`INSERT INTO usuarios (nome,email,senha_hash,tipo) VALUES
    ('Médico QA','qa.notifications@example.test',${hash},'MEDICO') RETURNING id`
  await pg`INSERT INTO medicos (usuario_id,crm,uf_crm,especialidade) VALUES (${u.id},'998877','SP','Clínica Médica')`
  const [g] = await pg`INSERT INTO usuarios (nome,email,senha_hash,tipo) VALUES
    ('Gestor QA','gestor.qa@example.test',${hash},'GESTOR') RETURNING id`
  const [gestor] =
    await pg`INSERT INTO gestores (usuario_id) VALUES (${g.id}) RETURNING id`
  const [i] =
    await pg`INSERT INTO instituicoes (usuario_id,nome,cnpj,cidade,uf) VALUES
    (${g.id},'Hospital QA','11222333000181','São Paulo','SP') RETURNING id`
  await pg`INSERT INTO gestores_instituicoes (gestor_id,instituicao_id) VALUES (${gestor.id},${i.id})`
  const [p] =
    await pg`INSERT INTO plantoes (instituicao_id,gestor_criador_id,titulo,local_unidade,especialidade,
    data_inicio,data_fim,valor,quantidade_vagas,vagas_disponiveis,status) VALUES
    (${i.id},${g.id},'Plantão QA notificações','Unidade QA','Clínica Médica',now()+interval '2 days',now()+interval '2 days 12 hours',1000,2,2,'ABERTO') RETURNING id`
  await pg`INSERT INTO preferencias_notificacao (usuario_id,push,email) VALUES (${u.id},true,true)`
  const [n] =
    await pg`INSERT INTO notificacoes (usuario_destino_id,plantao_id,tipo) VALUES (${u.id},${p.id},'ALOCACAO_APROVADA') RETURNING id`
  const config = {
    NODE_ENV: 'test',
    HOST: '0.0.0.0',
    PORT: '3309',
    DATABASE_URL: url.toString(),
    JWT_SECRET: 'isolated-android-qa-secret-at-least-32-characters',
    JWT_EXPIRES: '900',
    SMTP_HOST: '127.0.0.1',
    SMTP_PORT: '51025',
    SMTP_USER: '',
    SMTP_PASS: '',
    SMTP_FROM: 'qa@example.test',
    ADMIN_EMAIL: '',
    ADMIN_PASSWORD: '',
  }
  // Aplicação ConfigModule valida campos ADMIN vazios: remover em vez de injetar.
  delete (config as Partial<typeof config>).ADMIN_EMAIL
  delete (config as Partial<typeof config>).ADMIN_PASSWORD
  await writeFile('/tmp/alocca-android-qa.json', JSON.stringify(config), {
    mode: 0o600,
  })
  pronto = true
  console.log(
    JSON.stringify({
      banco: nome,
      usuario: u.id,
      plantao: p.id,
      notificacao: n.id,
      api: 'http://127.0.0.1:3309',
    }),
  )
} finally {
  await pg.end()
  if (!pronto) await admin.unsafe(`DROP DATABASE ${nome} WITH (FORCE)`)
  await admin.end()
}
