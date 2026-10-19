import 'dotenv/config'
import { eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { PasswordService } from '../auth/password.service.js'
import { validateEnv } from '../config/env.js'
import {
  gestoresTable,
  instituicoesTable,
  plantoesTable,
  usuariosTable,
} from './schemas/index.js'

const env = validateEnv(process.env)
const client = postgres(env.DATABASE_URL)
const db = drizzle({ client })
const passwords = new PasswordService()

const EMAIL_GESTOR = 'gestor.seed@alocca.local'
const SENHA_GESTOR = 'senha-segura-123'
const CNPJ = '12345678000199'

async function garantirUsuarioGestor(): Promise<string> {
  const [existente] = await db
    .select({ id: usuariosTable.id })
    .from(usuariosTable)
    .where(eq(usuariosTable.email, EMAIL_GESTOR))
    .limit(1)
  if (existente) return existente.id
  const [criado] = await db
    .insert(usuariosTable)
    .values({
      nome: 'Gestor Seed',
      email: EMAIL_GESTOR,
      senha_hash: await passwords.hash(SENHA_GESTOR),
      tipo: 'GESTOR',
      status: 'ATIVO',
    })
    .returning({ id: usuariosTable.id })
  return criado.id
}

async function garantirInstituicao(usuarioId: string): Promise<string> {
  const [existente] = await db
    .select({ id: instituicoesTable.id })
    .from(instituicoesTable)
    .where(eq(instituicoesTable.cnpj, CNPJ))
    .limit(1)
  if (existente) return existente.id
  const [criada] = await db
    .insert(instituicoesTable)
    .values({
      usuario_id: usuarioId,
      nome: 'Hospital Seed LTDA',
      nome_fantasia: 'Hospital Seed',
      cnpj: CNPJ,
      cidade: 'Brasília',
      uf: 'DF',
    })
    .returning({ id: instituicoesTable.id })
  return criada.id
}

async function garantirGestor(
  usuarioId: string,
  instituicaoId: string,
): Promise<string> {
  const [existente] = await db
    .select({ id: gestoresTable.id })
    .from(gestoresTable)
    .where(eq(gestoresTable.usuario_id, usuarioId))
    .limit(1)
  if (existente) return existente.id
  const [criado] = await db
    .insert(gestoresTable)
    .values({
      usuario_id: usuarioId,
      instituicao_id: instituicaoId,
      cargo: 'Diretor Clínico',
    })
    .returning({ id: gestoresTable.id })
  return criado.id
}

async function main(): Promise<void> {
  const usuarioId = await garantirUsuarioGestor()
  const instituicaoId = await garantirInstituicao(usuarioId)
  const gestorId = await garantirGestor(usuarioId, instituicaoId)

  const plantoesExistentes = await db
    .select({ id: plantoesTable.id })
    .from(plantoesTable)
    .where(eq(plantoesTable.instituicao_id, instituicaoId))
  if (plantoesExistentes.length === 0) {
    const base = Date.now() + 24 * 60 * 60 * 1000
    const dia = 24 * 60 * 60 * 1000
    const meioDia = 12 * 60 * 60 * 1000
    await db.insert(plantoesTable).values([
      {
        instituicao_id: instituicaoId,
        criado_por_gestor_id: gestorId,
        titulo: 'Plantão UTI Adulto — Diurno',
        especialidade: 'Medicina Intensiva',
        data_inicio: new Date(base),
        data_fim: new Date(base + meioDia),
        valor: '1800.00',
        quantidade_vagas: 2,
        vagas_disponiveis: 2,
        status: 'ABERTO',
      },
      {
        instituicao_id: instituicaoId,
        criado_por_gestor_id: gestorId,
        titulo: 'Plantão Pronto Socorro — Noturno',
        especialidade: 'Clínica Médica',
        data_inicio: new Date(base + 2 * dia),
        data_fim: new Date(base + 2 * dia + meioDia),
        valor: '1900.00',
        quantidade_vagas: 1,
        vagas_disponiveis: 1,
        status: 'ABERTO',
      },
    ])
  }

  console.log(
    'Seed concluído. Gestor: %s | Instituição: %s | Login: %s / %s',
    usuarioId,
    instituicaoId,
    EMAIL_GESTOR,
    SENHA_GESTOR,
  )
}

try {
  await main()
} finally {
  await client.end()
}
