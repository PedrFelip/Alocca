import 'dotenv/config'
import { and, eq, inArray, or } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/postgres-js'
import type { AnyPgColumn } from 'drizzle-orm/pg-core'
import { criarClientePostgres } from './cliente-postgres.ts'
import { PasswordService } from '../auth/password.service.ts'
import { validateEnv } from '../config/env.ts'
import {
  alocacoesTable,
  candidaturasTable,
  gestoresInstituicoesTable,
  gestoresTable,
  instituicoesTable,
  medicosTable,
  notificacoesTable,
  pagamentosTable,
  plantoesTable,
  registrosPontoTable,
  tokensRecuperacaoSenhaTable,
  usuariosTable,
} from './schemas/index.ts'

const env = validateEnv(process.env)
if (env.NODE_ENV === 'production') {
  throw new Error('Seed bloqueado em produção (NODE_ENV=production)')
}
const client = criarClientePostgres(env.DATABASE_URL)
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
      latitude: -15.8011,
      longitude: -47.8838,
    })
    .returning({ id: instituicoesTable.id })
  return criada.id
}

async function garantirGestor(usuarioId: string): Promise<string> {
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
      cargo: 'Diretor Clínico',
    })
    .returning({ id: gestoresTable.id })
  return criado.id
}

async function garantirVinculo(
  gestorId: string,
  instituicaoId: string,
): Promise<void> {
  await db
    .insert(gestoresInstituicoesTable)
    .values({ gestor_id: gestorId, instituicao_id: instituicaoId })
    .onConflictDoNothing()
}

async function main(): Promise<void> {
  const usuarioId = await garantirUsuarioGestor()
  const instituicaoId = await garantirInstituicao(usuarioId)
  const gestorId = await garantirGestor(usuarioId)
  await garantirVinculo(gestorId, instituicaoId)

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
        gestor_criador_id: usuarioId,
        titulo: 'Plantão UTI Adulto — Diurno',
        local_unidade: 'UTI Adulto — 3º andar',
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
        gestor_criador_id: usuarioId,
        titulo: 'Plantão Pronto Socorro — Noturno',
        local_unidade: 'Pronto Socorro — Porta de entrada',
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

  if (RESET_DEMO) await removerDadosDemo(usuarioId)
  const medicoCriado = await semearDadosDemo(usuarioId, instituicaoId, gestorId)

  console.log(
    'Seed concluído. Gestor: %s | Instituição: %s | Login: %s / %s',
    usuarioId,
    instituicaoId,
    EMAIL_GESTOR,
    SENHA_GESTOR,
  )
  console.log(
    medicoCriado
      ? 'Médico demo criado. Login: %s / %s'
      : 'Médico demo já existia (dados demo mantidos). Login: %s / %s',
    EMAIL_MEDICO,
    SENHA_MEDICO,
  )
}

// ---------------------------------------------------------------------------
// Dados de demonstração do app do médico.
//
// Datas relativas ao momento em que o seed roda: há um plantão "agora" com
// check-in liberado, plantões passados concluídos (com ponto e pagamento) e
// futuros confirmados. Idempotente: se o médico demo já existe, nada é recriado.
// Para regenerar com datas novas (ex.: no dia da apresentação):
//   bun run seed --reset-demo
// remove só o médico demo e os plantões demo (e o que depende deles) e recria.
// ---------------------------------------------------------------------------

const RESET_DEMO = process.argv.includes('--reset-demo')
const EMAIL_MEDICO = 'medico.demo@alocca.local'
// Segue a RN05 (maiúscula, minúscula e número) para não quebrar se o app
// passar a validar o formato também no login.
const SENHA_MEDICO = 'SenhaSegura123'

const HORA = 60 * 60 * 1000
const DIA = 24 * HORA

type InstituicaoDemo = {
  nome: string
  nome_fantasia: string
  cnpj: string
  cidade: string
  uf: string
  latitude: number
  longitude: number
}

const INSTITUICOES_DEMO: InstituicaoDemo[] = [
  {
    nome: 'Hospital São Lucas',
    nome_fantasia: 'Hospital São Lucas',
    cnpj: '11222333000181',
    cidade: 'Brasília',
    uf: 'DF',
    latitude: -15.7942,
    longitude: -47.8822,
  },
  {
    nome: 'Hospital Santa Clara',
    nome_fantasia: 'Hospital Santa Clara',
    cnpj: '44555666000172',
    cidade: 'Taguatinga',
    uf: 'DF',
    latitude: -15.8333,
    longitude: -48.0564,
  },
]

async function garantirInstituicaoDemo(
  usuarioId: string,
  dados: InstituicaoDemo,
): Promise<string> {
  const [existente] = await db
    .select({ id: instituicoesTable.id })
    .from(instituicoesTable)
    .where(eq(instituicoesTable.cnpj, dados.cnpj))
    .limit(1)
  if (existente) {
    await db
      .update(instituicoesTable)
      .set(dados)
      .where(eq(instituicoesTable.id, existente.id))
    return existente.id
  }
  const [criada] = await db
    .insert(instituicoesTable)
    .values({ usuario_id: usuarioId, ...dados })
    .returning({ id: instituicoesTable.id })
  return criada.id
}

/** 07:00 de hoje em America/Sao_Paulo (UTC-3 fixo, como na agenda). */
function seteDaManhaDeHoje(ms: number): number {
  const OFFSET = 3 * HORA
  const meiaNoiteLocal = Math.floor((ms - OFFSET) / DIA) * DIA + OFFSET
  return meiaNoiteLocal + 7 * HORA
}

// Títulos dos plantões demo: é por eles (+ gestor do seed) que o --reset-demo
// encontra o que apagar. criarPlantao recusa título fora desta lista.
// Atenção: se o gestor do seed criar pela UC10 um plantão com um destes
// títulos, o --reset-demo também vai apagá-lo. Aceitável para dados de demo.
const TITULOS_DEMO = [
  'Plantão Clínica Médica — Diurno',
  'Plantão Emergência — Noturno',
  'Plantão Enfermaria — Diurno',
  'Plantão Clínica Médica — Hoje',
  'Plantão Pediatria — Noturno',
  'Plantão UTI — Diurno',
  'Plantão Clínica Médica — Final de semana',
  'Plantão Cardiologia — Diurno',
  'Plantão Ortopedia — Noturno',
  'Plantão Pediatria — Diurno',
  'Plantão Ginecologia e Obstetrícia — 24h',
  'Plantão Clínica Médica — Noturno',
]

async function removerDadosDemo(gestorUsuarioId: string): Promise<void> {
  await db.transaction(async (tx) => {
    const [usuario] = await tx
      .select({ id: usuariosTable.id })
      .from(usuariosTable)
      .where(eq(usuariosTable.email, EMAIL_MEDICO))
      .limit(1)
    const [medico] = usuario
      ? await tx
          .select({ id: medicosTable.id })
          .from(medicosTable)
          .where(eq(medicosTable.usuario_id, usuario.id))
          .limit(1)
      : []
    const plantaoIds = (
      await tx
        .select({ id: plantoesTable.id })
        .from(plantoesTable)
        .where(
          and(
            eq(plantoesTable.gestor_criador_id, gestorUsuarioId),
            inArray(plantoesTable.titulo, TITULOS_DEMO),
          ),
        )
    ).map((p) => p.id)
    const doPlantao = (col: AnyPgColumn) =>
      plantaoIds.length > 0 ? inArray(col, plantaoIds) : undefined
    const alocacaoIds = (
      await tx
        .select({ id: alocacoesTable.id })
        .from(alocacoesTable)
        .where(
          or(
            doPlantao(alocacoesTable.plantao_id),
            medico ? eq(alocacoesTable.medico_id, medico.id) : undefined,
          ),
        )
    ).map((a) => a.id)
    if (alocacaoIds.length > 0) {
      await tx
        .delete(registrosPontoTable)
        .where(inArray(registrosPontoTable.alocacao_id, alocacaoIds))
      await tx
        .delete(pagamentosTable)
        .where(inArray(pagamentosTable.alocacao_id, alocacaoIds))
      await tx
        .delete(alocacoesTable)
        .where(inArray(alocacoesTable.id, alocacaoIds))
    }
    const filtroCandidaturas = or(
      doPlantao(candidaturasTable.plantao_id),
      medico ? eq(candidaturasTable.medico_id, medico.id) : undefined,
    )
    if (filtroCandidaturas) {
      await tx.delete(candidaturasTable).where(filtroCandidaturas)
    }
    const filtroNotificacoes = or(
      doPlantao(notificacoesTable.plantao_id),
      usuario
        ? eq(notificacoesTable.usuario_destino_id, usuario.id)
        : undefined,
    )
    if (filtroNotificacoes) {
      await tx.delete(notificacoesTable).where(filtroNotificacoes)
    }
    if (plantaoIds.length > 0) {
      await tx
        .delete(plantoesTable)
        .where(inArray(plantoesTable.id, plantaoIds))
    }
    if (medico)
      await tx.delete(medicosTable).where(eq(medicosTable.id, medico.id))
    if (usuario) {
      await tx
        .delete(tokensRecuperacaoSenhaTable)
        .where(eq(tokensRecuperacaoSenhaTable.usuario_id, usuario.id))
      await tx.delete(usuariosTable).where(eq(usuariosTable.id, usuario.id))
    }
    console.log(
      'Dados demo removidos: %d plantões, %d alocações.',
      plantaoIds.length,
      alocacaoIds.length,
    )
  })
}

async function semearDadosDemo(
  gestorUsuarioId: string,
  seedId: string,
  gestorId: string,
): Promise<boolean> {
  const [jaExiste] = await db
    .select({ id: usuariosTable.id })
    .from(usuariosTable)
    .where(eq(usuariosTable.email, EMAIL_MEDICO))
    .limit(1)
  if (jaExiste) return false

  const saoLucasId = await garantirInstituicaoDemo(
    gestorUsuarioId,
    INSTITUICOES_DEMO[0],
  )
  const santaClaraId = await garantirInstituicaoDemo(
    gestorUsuarioId,
    INSTITUICOES_DEMO[1],
  )
  await garantirVinculo(gestorId, saoLucasId)
  await garantirVinculo(gestorId, santaClaraId)

  const senhaHash = await passwords.hash(SENHA_MEDICO)
  const agora = Date.now()
  const hoje = seteDaManhaDeHoje(agora)

  await db.transaction(async (tx) => {
    const [usuario] = await tx
      .insert(usuariosTable)
      .values({
        nome: 'Dra. Mariana Costa',
        cpf: '52998224725',
        email: EMAIL_MEDICO,
        senha_hash: senhaHash,
        telefone: '61988887777',
        tipo: 'MEDICO',
        status: 'ATIVO',
      })
      .returning({ id: usuariosTable.id })
    const [medico] = await tx
      .insert(medicosTable)
      .values({
        usuario_id: usuario.id,
        crm: '123456',
        uf_crm: 'DF',
        especialidade: 'Clínica Médica',
        status_validacao: 'APROVADO',
        validado_at: new Date(agora - 30 * DIA),
      })
      .returning({ id: medicosTable.id })

    type Plantao = {
      instituicao_id: string
      titulo: string
      local_unidade: string
      especialidade: string
      inicio: number
      duracaoHoras: number
      valor: string
      vagas: number
    }
    const criarPlantao = async (p: Plantao, ocupadas: number) => {
      if (!TITULOS_DEMO.includes(p.titulo)) {
        throw new Error(`Título demo fora de TITULOS_DEMO: ${p.titulo}`)
      }
      const fim = p.inicio + p.duracaoHoras * HORA
      const disponiveis = p.vagas - ocupadas
      const [criado] = await tx
        .insert(plantoesTable)
        .values({
          instituicao_id: p.instituicao_id,
          gestor_criador_id: gestorUsuarioId,
          titulo: p.titulo,
          local_unidade: p.local_unidade,
          especialidade: p.especialidade,
          data_inicio: new Date(p.inicio),
          data_fim: new Date(fim),
          valor: p.valor,
          quantidade_vagas: p.vagas,
          vagas_disponiveis: disponiveis,
          status:
            fim < agora
              ? 'CONCLUIDO'
              : disponiveis === 0
                ? 'PREENCHIDO'
                : 'ABERTO',
        })
        .returning({ id: plantoesTable.id })
      return criado.id
    }

    /** Candidatura aprovada + alocação; opcionalmente ponto e pagamento. */
    const alocar = async (
      p: Plantao,
      opcoes: {
        ponto?: boolean
        pagamento?: { status: 'PAGO' | 'PENDENTE'; vencimento: number }
      } = {},
    ) => {
      const plantaoId = await criarPlantao(p, 1)
      const [candidatura] = await tx
        .insert(candidaturasTable)
        .values({
          plantao_id: plantaoId,
          medico_id: medico.id,
          status: 'APROVADA',
          analisado_por_gestor_id: gestorId,
          analisado_at: new Date(p.inicio - 5 * DIA),
          created_at: new Date(p.inicio - 7 * DIA),
        })
        .returning({ id: candidaturasTable.id })
      const [alocacao] = await tx
        .insert(alocacoesTable)
        .values({
          plantao_id: plantaoId,
          medico_id: medico.id,
          candidatura_id: candidatura.id,
          confirmado_at: new Date(p.inicio - 5 * DIA),
        })
        .returning({ id: alocacoesTable.id })
      const fim = p.inicio + p.duracaoHoras * HORA
      if (opcoes.ponto) {
        await tx.insert(registrosPontoTable).values([
          {
            alocacao_id: alocacao.id,
            tipo_evento: 'ENTRADA',
            timestamp_servidor: new Date(p.inicio - 5 * 60 * 1000),
            latitude: -15.7943,
            longitude: -47.8821,
            precisao_metros: 12,
            distancia_local: 15,
          },
          {
            alocacao_id: alocacao.id,
            tipo_evento: 'SAIDA',
            timestamp_servidor: new Date(fim + 10 * 60 * 1000),
          },
        ])
      }
      if (opcoes.pagamento) {
        await tx.insert(pagamentosTable).values({
          alocacao_id: alocacao.id,
          valor: p.valor,
          status: opcoes.pagamento.status,
          vencimento_em: new Date(opcoes.pagamento.vencimento),
          pago_at:
            opcoes.pagamento.status === 'PAGO'
              ? new Date(opcoes.pagamento.vencimento - DIA)
              : null,
          registrado_por_gestor_id:
            opcoes.pagamento.status === 'PAGO' ? gestorId : null,
        })
      }
    }

    // Passados: concluídos, com ponto e pagamento (2 pagos, 1 pendente vencido).
    await alocar(
      {
        instituicao_id: saoLucasId,
        titulo: 'Plantão Clínica Médica — Diurno',
        local_unidade: 'Pronto Atendimento — Térreo',
        especialidade: 'Clínica Médica',
        inicio: hoje - 20 * DIA,
        duracaoHoras: 12,
        valor: '1500.00',
        vagas: 2,
      },
      {
        ponto: true,
        pagamento: { status: 'PAGO', vencimento: hoje - 10 * DIA },
      },
    )
    await alocar(
      {
        instituicao_id: santaClaraId,
        titulo: 'Plantão Emergência — Noturno',
        local_unidade: 'Emergência Adulto',
        especialidade: 'Clínica Médica',
        inicio: hoje - 12 * DIA + 12 * HORA,
        duracaoHoras: 12,
        valor: '1700.00',
        vagas: 1,
      },
      {
        ponto: true,
        pagamento: { status: 'PAGO', vencimento: hoje - 3 * DIA },
      },
    )
    await alocar(
      {
        instituicao_id: seedId,
        titulo: 'Plantão Enfermaria — Diurno',
        local_unidade: 'Enfermaria — 2º andar',
        especialidade: 'Clínica Médica',
        inicio: hoje - 6 * DIA,
        duracaoHoras: 12,
        valor: '1400.00',
        vagas: 1,
      },
      {
        ponto: true,
        pagamento: { status: 'PENDENTE', vencimento: hoje - DIA },
      },
    )

    // Agora: começou há 30 min, check-in liberado (janela: 10 min antes até o fim).
    await alocar(
      {
        instituicao_id: saoLucasId,
        titulo: 'Plantão Clínica Médica — Hoje',
        local_unidade: 'Pronto Atendimento — Térreo',
        especialidade: 'Clínica Médica',
        inicio: agora - 30 * 60 * 1000,
        duracaoHoras: 12,
        valor: '1500.00',
        vagas: 2,
      },
      { pagamento: { status: 'PENDENTE', vencimento: hoje + 15 * DIA } },
    )

    // Futuros confirmados, com pagamento a receber.
    await alocar(
      {
        instituicao_id: santaClaraId,
        titulo: 'Plantão Pediatria — Noturno',
        local_unidade: 'Pronto Socorro Infantil',
        especialidade: 'Clínica Médica',
        inicio: hoje + 4 * DIA + 12 * HORA,
        duracaoHoras: 12,
        valor: '1600.00',
        vagas: 1,
      },
      { pagamento: { status: 'PENDENTE', vencimento: hoje + 20 * DIA } },
    )
    await alocar(
      {
        instituicao_id: saoLucasId,
        titulo: 'Plantão UTI — Diurno',
        local_unidade: 'UTI Adulto — 4º andar',
        especialidade: 'Clínica Médica',
        inicio: hoje + 9 * DIA,
        duracaoHoras: 12,
        valor: '2100.00',
        vagas: 1,
      },
      { pagamento: { status: 'PENDENTE', vencimento: hoje + 25 * DIA } },
    )

    // Abertos no feed: dois com candidatura pendente, um rejeitado e o resto livre.
    const abertos: Array<Plantao & { candidatura?: 'PENDENTE' | 'REJEITADA' }> =
      [
        {
          instituicao_id: santaClaraId,
          titulo: 'Plantão Clínica Médica — Final de semana',
          local_unidade: 'Pronto Atendimento',
          especialidade: 'Clínica Médica',
          inicio: hoje + 2 * DIA,
          duracaoHoras: 12,
          valor: '1750.00',
          vagas: 2,
          candidatura: 'PENDENTE',
        },
        {
          instituicao_id: saoLucasId,
          titulo: 'Plantão Cardiologia — Diurno',
          local_unidade: 'Unidade Coronariana',
          especialidade: 'Cardiologia',
          inicio: hoje + 6 * DIA,
          duracaoHoras: 12,
          valor: '2300.00',
          vagas: 1,
          candidatura: 'PENDENTE',
        },
        {
          instituicao_id: seedId,
          titulo: 'Plantão Ortopedia — Noturno',
          local_unidade: 'Pronto Socorro Ortopédico',
          especialidade: 'Ortopedia',
          inicio: hoje + 3 * DIA + 12 * HORA,
          duracaoHoras: 12,
          valor: '1950.00',
          vagas: 1,
          candidatura: 'REJEITADA',
        },
        {
          instituicao_id: saoLucasId,
          titulo: 'Plantão Pediatria — Diurno',
          local_unidade: 'Pediatria — 1º andar',
          especialidade: 'Pediatria',
          inicio: hoje + 5 * DIA,
          duracaoHoras: 12,
          valor: '1650.00',
          vagas: 3,
        },
        {
          instituicao_id: santaClaraId,
          titulo: 'Plantão Ginecologia e Obstetrícia — 24h',
          local_unidade: 'Centro Obstétrico',
          especialidade: 'Ginecologia e Obstetrícia',
          inicio: hoje + 8 * DIA,
          duracaoHoras: 24,
          valor: '3200.00',
          vagas: 2,
        },
        {
          instituicao_id: seedId,
          titulo: 'Plantão Clínica Médica — Noturno',
          local_unidade: 'Enfermaria — 2º andar',
          especialidade: 'Clínica Médica',
          inicio: hoje + 11 * DIA + 12 * HORA,
          duracaoHoras: 12,
          valor: '1450.00',
          vagas: 2,
        },
      ]
    for (const { candidatura, ...plantao } of abertos) {
      const plantaoId = await criarPlantao(plantao, 0)
      if (candidatura) {
        await tx.insert(candidaturasTable).values({
          plantao_id: plantaoId,
          medico_id: medico.id,
          status: candidatura,
          mensagem_medico: 'Tenho disponibilidade e experiência no setor.',
          ...(candidatura === 'REJEITADA'
            ? {
                observacao_gestor:
                  'Vaga destinada a especialista em ortopedia.',
                analisado_por_gestor_id: gestorId,
                analisado_at: new Date(agora - DIA),
              }
            : {}),
        })
      }
    }
  })
  return true
}

try {
  await main()
} finally {
  await client.end()
}
