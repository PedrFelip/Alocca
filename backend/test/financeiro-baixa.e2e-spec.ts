import { PGlite } from '@electric-sql/pglite'
import {
  NotFoundException,
  ServiceUnavailableException,
  type INestApplication,
} from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { JwtService } from '@nestjs/jwt'
import { Test } from '@nestjs/testing'
import { drizzle } from 'drizzle-orm/pglite'
import { drizzle as drizzlePostgres } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { readFile, readdir } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import request from 'supertest'
import { vi } from 'vitest'
import { AppModule } from '../src/app.module.ts'
import { DRIZZLE_DB } from '../src/db/db.provider.ts'
import { criarClientePostgres } from '../src/db/cliente-postgres.ts'
import { GestoresService } from '../src/gestores/gestores.service.ts'
import { ComprovantesStorage } from '../src/financeiro/comprovantes.storage.ts'

const pdf = Buffer.from('%PDF-1.4\nconteudo\n%%EOF')
const jpeg = Buffer.from([255, 216, 255, 0, 255, 217])
const png = Buffer.from([
  137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0, 73, 69, 78, 68, 174, 66, 96, 130,
])
const limite = 5 * 1024 * 1024

describe('Baixa financeira e comprovantes (#85 e #86)', () => {
  let app: INestApplication
  let db: PGlite
  let pg: postgres.Sql | undefined
  let admin: postgres.Sql | undefined
  const banco = `alocca_financeiro_qa_${Date.now().toString(36)}`
  let gestor: string,
    outroGestor: string,
    inativo: string,
    medico: string,
    outroMedico: string
  let instituicao: string,
    outraInstituicao: string,
    gestorId: string,
    gestorUsuarioId: string,
    medicoId: string
  const objetos = new Map<string, { buffer: Buffer; mime: string }>()
  const storage = {
    salvar: vi.fn(async (chave: string, buffer: Buffer, mime: string) => {
      objetos.set(chave, { buffer, mime })
    }),
    remover: vi.fn(async (chave: string) => {
      objetos.delete(chave)
    }),
    baixar: vi.fn(async (chave: string) => {
      const objeto = objetos.get(chave)
      if (!objeto) throw new NotFoundException('Comprovante não encontrado')
      return objeto.buffer
    }),
  }
  beforeAll(async () => {
    const url = process.env.E2E_FINANCEIRO_PG_ADMIN
    if (url) {
      admin = postgres(url, { max: 1 })
      await admin.unsafe(`CREATE DATABASE ${banco}`)
      const destino = new URL(url)
      destino.pathname = `/${banco}`
      // Mesma fábrica da produção: sessão em UTC e parser de timestamp
      // sem fuso ancorado em UTC, para os testes não validarem o fuso
      // sob outra convenção (#78).
      pg = criarClientePostgres(destino.toString(), { max: 5 })
      // Adaptador só do fixture: cada chamada preserva parâmetros SQL.
      db = {
        query: async (texto: string, parametros: unknown[] = []) => ({
          rows: await pg!.unsafe(texto, parametros as never),
        }),
        exec: (texto: string) => pg!.unsafe(texto),
        close: () => pg!.end(),
      } as unknown as PGlite
    } else {
      db = new PGlite()
      // Paridade com a produção: now() e strings de vencimento classificados
      // em UTC, como o criarClientePostgres garante no Postgres real (#78).
      await db.exec("SET TimeZone = 'UTC'")
    }
    for (const directory of (await readdir('drizzle')).sort())
      await db.exec(
        await readFile(`drizzle/${directory}/migration.sql`, 'utf8'),
      )
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(DRIZZLE_DB)
      .useValue(pg ? drizzlePostgres({ client: pg }) : drizzle({ client: db }))
      .overrideProvider(ComprovantesStorage)
      .useValue(storage)
      .compile()
    app = module.createNestApplication()
    await app.init()
  }, 30000)
  beforeEach(async () => {
    objetos.clear()
    storage.salvar
      .mockReset()
      .mockImplementation(async (chave, buffer, mime) => {
        objetos.set(chave, { buffer, mime })
      })
    storage.remover.mockReset().mockImplementation(async (chave) => {
      objetos.delete(chave)
    })
    storage.baixar.mockReset().mockImplementation(async (chave) => {
      const objeto = objetos.get(chave)
      if (!objeto) throw new NotFoundException('Comprovante não encontrado')
      return objeto.buffer
    })
    await db.exec(
      `TRUNCATE notificacoes, pagamentos, registros_ponto, alocacoes, candidaturas, plantoes, gestores_instituicoes, gestores, instituicoes, medicos, tokens_recuperacao_senha, usuarios CASCADE`,
    )
    const usuarios = (
      await db.query<{ id: string; nome: string }>(
        `INSERT INTO usuarios (nome, email, senha_hash, tipo) VALUES ('Gestor', 'g@example.com', 'hash', 'GESTOR'), ('Outro Gestor', 'g2@example.com', 'hash', 'GESTOR'), ('Inativo', 'gi@example.com', 'hash', 'GESTOR'), ('Medico', 'm@example.com', 'hash', 'MEDICO'), ('Outro Medico', 'm2@example.com', 'hash', 'MEDICO') RETURNING id, nome`,
      )
    ).rows
    const id = (nome: string) => usuarios.find((u) => u.nome === nome)!.id
    gestorUsuarioId = id('Gestor')
    const gestores = (
      await db.query<{ id: string; usuario_id: string }>(
        `INSERT INTO gestores (usuario_id, ativa) VALUES ($1, true), ($2, true), ($3, false) RETURNING id, usuario_id`,
        [gestorUsuarioId, id('Outro Gestor'), id('Inativo')],
      )
    ).rows
    gestorId = gestores.find((g) => g.usuario_id === gestorUsuarioId)!.id
    const medicos = (
      await db.query<{ id: string; usuario_id: string }>(
        `INSERT INTO medicos (usuario_id, crm, uf_crm, especialidade) VALUES ($1, '123456', 'DF', 'Clínica'), ($2, '654321', 'SP', 'Clínica') RETURNING id, usuario_id`,
        [id('Medico'), id('Outro Medico')],
      )
    ).rows
    medicoId = medicos.find((m) => m.usuario_id === id('Medico'))!.id
    const instituicoes = (
      await db.query<{ id: string; nome: string }>(
        `INSERT INTO instituicoes (usuario_id, nome, cnpj, cidade, uf) VALUES ($1, 'Hospital A', '33333333000133', 'Brasília', 'DF'), ($2, 'Hospital B', '44444444000144', 'Brasília', 'DF') RETURNING id, nome`,
        [gestorUsuarioId, id('Outro Gestor')],
      )
    ).rows
    instituicao = instituicoes.find((i) => i.nome === 'Hospital A')!.id
    outraInstituicao = instituicoes.find((i) => i.nome === 'Hospital B')!.id
    await db.query(
      'INSERT INTO gestores_instituicoes (gestor_id, instituicao_id) VALUES ($1, $2), ($3, $4)',
      [
        gestorId,
        instituicao,
        gestores.find((g) => g.usuario_id === id('Outro Gestor'))!.id,
        outraInstituicao,
      ],
    )
    const jwt = app.get(JwtService)
    const token = async (nome: string) =>
      `Bearer ${await jwt.signAsync({ sub: id(nome) })}`
    gestor = await token('Gestor')
    outroGestor = await token('Outro Gestor')
    inativo = await token('Inativo')
    medico = await token('Medico')
    outroMedico = await token('Outro Medico')
  })
  afterAll(async () => {
    await app?.close()
    await db?.close()
    if (admin) {
      await admin.unsafe(`DROP DATABASE ${banco}`)
      await admin.end()
    }
  })
  async function pagamento(
    op: {
      instituicao?: string
      futuro?: boolean
      status?: string
      vencimento?: string
      valor?: string
    } = {},
  ) {
    const inicio = op.futuro
      ? "now() + interval '1 day'"
      : "now() - interval '2 days'"
    const fim = op.futuro
      ? "now() + interval '2 days'"
      : "now() - interval '1 day'"
    const [plantao] = (
      await db.query<{ id: string }>(
        `INSERT INTO plantoes (instituicao_id, gestor_criador_id, titulo, local_unidade, especialidade, data_inicio, data_fim, valor, quantidade_vagas, vagas_disponiveis, status) VALUES ($1, $2, 'Plantão', 'Unidade', 'Clínica', ${inicio}, ${fim}, '100.00', 1, 1, 'PREENCHIDO') RETURNING id`,
        [op.instituicao ?? instituicao, gestorUsuarioId],
      )
    ).rows
    const [candidatura] = (
      await db.query<{ id: string }>(
        "INSERT INTO candidaturas (plantao_id, medico_id, status) VALUES ($1, $2, 'APROVADA') RETURNING id",
        [plantao.id, medicoId],
      )
    ).rows
    const [alocacao] = (
      await db.query<{ id: string }>(
        'INSERT INTO alocacoes (plantao_id, medico_id, candidatura_id) VALUES ($1, $2, $3) RETURNING id',
        [plantao.id, medicoId, candidatura.id],
      )
    ).rows
    const [p] = (
      await db.query<{ id: string }>(
        'INSERT INTO pagamentos (alocacao_id, valor, status, vencimento_em) VALUES ($1, $2, $3, $4) RETURNING id',
        [
          alocacao.id,
          op.valor ?? '100.00',
          op.status ?? 'PENDENTE',
          op.vencimento ?? null,
        ],
      )
    ).rows
    return { id: p.id, plantao: plantao.id, alocacao: alocacao.id }
  }
  const listar = (token: string) =>
    request(app.getHttpServer())
      .get('/financeiro/pendentes-baixa')
      .set('Authorization', token)
  const baixar = (
    id: string,
    token = gestor,
    buffer = pdf,
    nome = 'comprovante.pdf',
    mime = 'application/pdf',
  ) =>
    request(app.getHttpServer())
      .post(`/financeiro/pagamentos/${id}/dar-baixa`)
      .set('Authorization', token)
      .attach('comprovante', buffer, { filename: nome, contentType: mime })
  const comprovante = (id: string, token: string) =>
    request(app.getHttpServer())
      .get(`/financeiro/comprovantes/${id}`)
      .set('Authorization', token)
  const resumo = async () =>
    (
      await request(app.getHttpServer())
        .get('/financeiro/medico')
        .set('Authorization', medico)
        .expect(200)
    ).body.resumo

  it('protege endpoints por autenticação, perfil e gestor ativo', async () => {
    const p = await pagamento()
    await request(app.getHttpServer())
      .get('/financeiro/pendentes-baixa')
      .expect(401)
    await request(app.getHttpServer())
      .post(`/financeiro/pagamentos/${p.id}/dar-baixa`)
      .attach('comprovante', pdf, 'a.pdf')
      .expect(401)
    await request(app.getHttpServer())
      .get(`/financeiro/comprovantes/${p.id}`)
      .expect(401)
    await listar(medico).expect(403)
    await listar(inativo).expect(403)
    await baixar(p.id, medico).expect(403)
    await baixar(p.id, inativo).expect(403)
    await comprovante(p.id, gestor).expect(404)
  })
  const pagamentosGestor = (token = gestor) =>
    request(app.getHttpServer())
      .get('/financeiro/pagamentos')
      .set('Authorization', token)
  const vencimento = (id: string, data: unknown, token = gestor) =>
    request(app.getHttpServer())
      .put(`/financeiro/pagamentos/${id}/vencimento`)
      .set('Authorization', token)
      .send({ vencimento_em: data })

  it('consulta histórico e comprovante com isolamento institucional', async () => {
    const p = await pagamento()
    await baixar(p.id).expect(200)
    await pagamento({ instituicao: outraInstituicao, status: 'PAGO' })
    const lista = (await pagamentosGestor().expect(200)).body
    expect(lista).toHaveLength(1)
    expect(lista[0]).toMatchObject({ id: p.id, status: 'PAGO' })
    expect(lista[0]).not.toHaveProperty('chave')
    expect((await comprovante(p.id, gestor).expect(200)).body).toEqual(pdf)
    await comprovante(p.id, outroGestor).expect(404)
    await comprovante(p.id, inativo).expect(403)
    await pagamentosGestor(medico).expect(403)
    await pagamentosGestor(inativo).expect(403)
  })

  it('define, altera e remove vencimento inclusive antes do encerramento', async () => {
    const p = await pagamento({ futuro: true })
    expect((await pagamentosGestor().expect(200)).body).toHaveLength(1)
    const passado = new Date(Date.now() - 86400000).toISOString()
    await vencimento(p.id, passado).expect(200)
    expect(await resumo()).toMatchObject({
      total_pendente: '100.00',
      total_a_receber: '0',
    })
    await vencimento(
      p.id,
      new Date(Date.now() + 86400000).toISOString(),
    ).expect(200)
    expect(await resumo()).toMatchObject({
      total_pendente: '0',
      total_a_receber: '100.00',
    })
    await vencimento(p.id, null).expect(200)
    expect(
      (await pagamentosGestor().expect(200)).body[0].vencimento_em,
    ).toBeNull()
    await baixar(p.id).expect(409)
  })

  it('valida vencimento, escopo e imutabilidade de pagos', async () => {
    const p = await pagamento()
    for (const data of ['inválido', '2026-02-30T12:00:00Z', '', 42])
      await vencimento(p.id, data).expect(400)
    await vencimento(p.id, null, medico).expect(403)
    await vencimento(p.id, null, inativo).expect(403)
    await vencimento(p.id, null, outroGestor).expect(404)
    await vencimento(randomUUID(), null).expect(404)
    await baixar(p.id).expect(200)
    await vencimento(p.id, null).expect(409)
  })

  // Regressão #78: o contrato (docs/contrato-financeiro.md) define GET
  // /financeiro/pagamentos como lista de pendentes E pagos; a aba "Histórico
  // de pagos" do app filtra status PAGO no cliente. O teste documenta esse
  // contrato e o isolamento por instituição dos dois status.
  it('histórico do gestor lista pendentes e pagos somente de suas instituições', async () => {
    const pagoProprio = await pagamento()
    await baixar(pagoProprio.id).expect(200)
    const pendenteProprio = await pagamento({ valor: '30.00' })
    const pagoAlheio = await pagamento({
      instituicao: outraInstituicao,
      status: 'PAGO',
    })
    const pendenteAlheio = await pagamento({ instituicao: outraInstituicao })
    const visaoPropria = (await pagamentosGestor().expect(200)).body
    expect(visaoPropria.map((p: { id: string }) => p.id).sort()).toEqual(
      [pagoProprio.id, pendenteProprio.id].sort(),
    )
    for (const linha of visaoPropria) {
      expect(linha).not.toHaveProperty('chave')
      expect(linha).not.toHaveProperty('mime')
      expect(linha).not.toHaveProperty('elegivel')
      expect(linha).not.toHaveProperty('gestor_id')
    }
    const visaoAlheia = (await pagamentosGestor(outroGestor).expect(200)).body
    expect(visaoAlheia.map((p: { id: string }) => p.id).sort()).toEqual(
      [pagoAlheio.id, pendenteAlheio.id].sort(),
    )
    await pagamentosGestor(medico).expect(403)
  })

  it('gestor não baixa comprovante de pagamento pendente ou pago sem arquivo', async () => {
    const pendente = await pagamento()
    await comprovante(pendente.id, gestor).expect(404)
    const legado = await pagamento({ status: 'PAGO' })
    await comprovante(legado.id, gestor).expect(404)
    await baixar(pendente.id).expect(200)
    await comprovante(pendente.id, gestor).expect(200)
    await comprovante(pendente.id, medico).expect(200)
  })

  it('remover vencimento devolve o valor a receber no resumo e no banco', async () => {
    const p = await pagamento({ valor: '70.00' })
    await vencimento(
      p.id,
      new Date(Date.now() - 86400000).toISOString(),
    ).expect(200)
    expect(await resumo()).toMatchObject({
      total_pendente: '70.00',
      total_a_receber: '0',
    })
    await vencimento(p.id, null).expect(200)
    expect(await resumo()).toMatchObject({
      total_pendente: '0',
      total_a_receber: '70.00',
    })
    expect(
      (
        await db.query<{ vencimento_em: Date | null }>(
          'SELECT vencimento_em FROM pagamentos WHERE id = $1',
          [p.id],
        )
      ).rows[0].vencimento_em,
    ).toBeNull()
  })

  it('exige corpo de vencimento estrito, sem campos extras', async () => {
    const p = await pagamento()
    await request(app.getHttpServer())
      .put(`/financeiro/pagamentos/${p.id}/vencimento`)
      .set('Authorization', gestor)
      .send({})
      .expect(400)
    await request(app.getHttpServer())
      .put(`/financeiro/pagamentos/${p.id}/vencimento`)
      .set('Authorization', gestor)
      .send({ vencimento_em: null, campo_extra: true })
      .expect(400)
    expect(
      (await pagamentosGestor().expect(200)).body[0].vencimento_em,
    ).toBeNull()
  })

  it('escopo precede status no vencimento: 404 para outro gestor e 409 para o dono', async () => {
    const pagoAlheio = await pagamento({
      instituicao: outraInstituicao,
      status: 'PAGO',
    })
    await vencimento(pagoAlheio.id, null, gestor).expect(404)
    await vencimento(pagoAlheio.id, null, outroGestor).expect(409)
  })

  it('lista somente pendentes encerrados e ativos da instituição vinculada', async () => {
    const elegivel = await pagamento()
    await pagamento({ futuro: true })
    await pagamento({ status: 'PAGO' })
    await pagamento({ instituicao: outraInstituicao })
    const cancelado = await pagamento()
    await db.query("UPDATE plantoes SET status = 'CANCELADO' WHERE id = $1", [
      cancelado.plantao,
    ])
    const excluido = await pagamento()
    await db.query('UPDATE plantoes SET deleted_at = now() WHERE id = $1', [
      excluido.plantao,
    ])
    const alocacao = await pagamento()
    await db.query('UPDATE alocacoes SET deleted_at = now() WHERE id = $1', [
      alocacao.alocacao,
    ])
    const removido = await pagamento()
    await db.query('UPDATE pagamentos SET deleted_at = now() WHERE id = $1', [
      removido.id,
    ])
    expect(
      (await listar(gestor).expect(200)).body.map((p: { id: string }) => p.id),
    ).toEqual([elegivel.id])
    expect((await listar(outroGestor).expect(200)).body).toHaveLength(1)
  })
  it('registra baixa, reflete resumo e entrega arquivo somente ao dono', async () => {
    const p = await pagamento()
    expect(await resumo()).toMatchObject({
      total_recebido: '0',
      total_a_receber: '100.00',
      total_pendente: '0',
    })
    expect((await baixar(p.id).expect(200)).body.message).toBe(
      'Comprovante anexado e status financeiro atualizado para "Pago".',
    )
    const [linha] = (
      await db.query<{
        status: string
        pago_at: Date
        comprovante_chave: string
        comprovante_mime: string
        registrado_por_gestor_id: string
      }>('SELECT * FROM pagamentos WHERE id = $1', [p.id])
    ).rows
    expect(linha).toMatchObject({
      status: 'PAGO',
      comprovante_mime: 'application/pdf',
      registrado_por_gestor_id: gestorId,
    })
    expect(linha.pago_at).toBeTruthy()
    expect(linha.comprovante_chave).toMatch(/^[\da-f-]{36}\.pdf$/)
    expect(objetos.get(linha.comprovante_chave)?.buffer).toEqual(pdf)
    expect(await resumo()).toMatchObject({
      total_recebido: '100.00',
      total_a_receber: '0',
      total_pendente: '0',
    })
    expect((await listar(gestor).expect(200)).body).toEqual([])
    const download = await comprovante(p.id, medico)
      .expect(200)
      .expect('Content-Type', /application\/pdf/)
    expect(download.body).toEqual(pdf)
    await comprovante(p.id, outroMedico).expect(404)
    await baixar(p.id).expect(409)
    expect(storage.salvar).toHaveBeenCalledTimes(1)
  })
  const integracaoStorage = process.env.E2E_SEAWEEDFS_FILER_URL ? it : it.skip
  integracaoStorage(
    'upload e download autenticados com SeaweedFS real',
    async () => {
      const real = new ComprovantesStorage(
        new ConfigService({
          SEAWEEDFS_FILER_URL: process.env.E2E_SEAWEEDFS_FILER_URL,
        }),
      )
      const p = await pagamento()
      let chave: string | undefined
      storage.salvar.mockImplementationOnce(async (key, buffer, mime) => {
        chave = key
        await real.salvar(key, buffer, mime)
      })
      storage.baixar.mockImplementationOnce((key) => real.baixar(key))
      try {
        await baixar(p.id).expect(200)
        const download = await comprovante(p.id, medico).expect(200)
        expect(download.body).toEqual(pdf)
        await comprovante(p.id, outroMedico).expect(404)
        expect(storage.baixar).toHaveBeenCalledTimes(1)
      } finally {
        if (chave) await real.remover(chave)
      }
    },
    30000,
  )
  const concorrencia = process.env.E2E_FINANCEIRO_PG_ADMIN ? it : it.skip
  concorrencia(
    'duas baixas simultâneas em PostgreSQL real geram um upload e um conflito',
    async () => {
      const p = await pagamento()
      storage.salvar.mockImplementationOnce(async (chave, buffer, mime) => {
        await new Promise((resolve) => setTimeout(resolve, 100))
        objetos.set(chave, { buffer, mime })
      })
      const respostas = await Promise.all([baixar(p.id), baixar(p.id)])
      expect(respostas.map((r) => r.status).sort((a, b) => a - b)).toEqual([
        200, 409,
      ])
      expect(storage.salvar).toHaveBeenCalledTimes(1)
      expect(objetos.size).toBe(1)
      const pagamentoFinal = (
        await db.query<{ status: string; comprovante_chave: string }>(
          'SELECT status, comprovante_chave FROM pagamentos WHERE id = $1',
          [p.id],
        )
      ).rows[0]
      expect(pagamentoFinal.status).toBe('PAGO')
      expect(objetos.has(pagamentoFinal.comprovante_chave)).toBe(true)
    },
  )
  const alteracoes = [
    'vinculo',
    'gestor_inativo',
    'gestor_excluido',
    'usuario_bloqueado',
    'plantao_cancelado',
    'plantao_excluido',
    'plantao_adiado',
    'instituicao_excluida',
    'alocacao_excluida',
  ] as const
  type Alteracao = (typeof alteracoes)[number]
  function mutacao(tipo: Alteracao, p: { plantao: string; alocacao: string }) {
    const comandos: Record<Alteracao, [string, string[]]> = {
      vinculo: [
        'DELETE FROM gestores_instituicoes WHERE gestor_id = $1 AND instituicao_id = $2',
        [gestorId, instituicao],
      ],
      gestor_inativo: [
        'UPDATE gestores SET ativa = false WHERE id = $1',
        [gestorId],
      ],
      gestor_excluido: [
        'UPDATE gestores SET deleted_at = now() WHERE id = $1',
        [gestorId],
      ],
      usuario_bloqueado: [
        "UPDATE usuarios SET status = 'BLOQUEADO' WHERE id = $1",
        [gestorUsuarioId],
      ],
      plantao_cancelado: [
        "UPDATE plantoes SET status = 'CANCELADO' WHERE id = $1",
        [p.plantao],
      ],
      plantao_excluido: [
        'UPDATE plantoes SET deleted_at = now() WHERE id = $1',
        [p.plantao],
      ],
      plantao_adiado: [
        "UPDATE plantoes SET data_fim = now() + interval '1 day' WHERE id = $1",
        [p.plantao],
      ],
      instituicao_excluida: [
        'UPDATE instituicoes SET deleted_at = now() WHERE id = $1',
        [instituicao],
      ],
      alocacao_excluida: [
        'UPDATE alocacoes SET deleted_at = now() WHERE id = $1',
        [p.alocacao],
      ],
    }
    return comandos[tipo]
  }

  it.each(alteracoes)(
    'revalida %s entre a consulta inicial do perfil e a transação',
    async (tipo) => {
      const p = await pagamento()
      const perfis = app.get(GestoresService)
      const original = perfis.perfilAtivo.bind(perfis)
      const espiao = vi
        .spyOn(perfis, 'perfilAtivo')
        .mockImplementationOnce(async (usuarioId) => {
          const perfil = await original(usuarioId)
          const [texto, params] = mutacao(tipo, p)
          await db.query(texto, params)
          return perfil
        })
      try {
        await baixar(p.id).expect(tipo === 'plantao_adiado' ? 409 : 404)
        expect(storage.salvar).not.toHaveBeenCalled()
        expect(
          (
            await db.query<{ status: string }>(
              'SELECT status FROM pagamentos WHERE id = $1',
              [p.id],
            )
          ).rows[0].status,
        ).toBe('PENDENTE')
      } finally {
        espiao.mockRestore()
      }
    },
  )

  concorrencia.each(alteracoes)(
    'protege %s durante upload em PostgreSQL real',
    async (tipo) => {
      const p = await pagamento()
      let entrou!: () => void
      let liberar!: () => void
      const iniciou = new Promise<void>((resolve) => {
        entrou = resolve
      })
      const liberado = new Promise<void>((resolve) => {
        liberar = resolve
      })
      storage.salvar.mockImplementationOnce(async (chave, buffer, mime) => {
        entrou()
        await liberado
        objetos.set(chave, { buffer, mime })
      })
      const resposta = baixar(p.id).then((r) => r)
      const [texto, params] = mutacao(tipo, p)
      try {
        await iniciou
        // Conexão independente: UPDATE/DELETE precisa esperar os locks da baixa.
        await expect(
          pg!.begin(async (outro) => {
            await outro.unsafe("SET LOCAL lock_timeout = '100ms'")
            await outro.unsafe(texto, params)
          }),
        ).rejects.toMatchObject({ code: '55P03' })
      } finally {
        liberar()
        expect((await resposta).status).toBe(200)
      }
      // Depois do commit a mesma alteração fica livre para prosseguir.
      await db.query(texto, params)
      expect(storage.salvar).toHaveBeenCalledTimes(1)
    },
  )

  concorrencia(
    'uploads de pagamentos distintos da mesma instituição avançam em paralelo',
    async () => {
      const primeiro = await pagamento()
      const segundo = await pagamento()
      let liberar!: () => void
      let ambos!: () => void
      let entradas = 0
      const liberado = new Promise<void>((resolve) => {
        liberar = resolve
      })
      const iniciados = new Promise<void>((resolve) => {
        ambos = resolve
      })
      storage.salvar.mockImplementation(async (chave, buffer, mime) => {
        if (++entradas === 2) ambos()
        await liberado
        objetos.set(chave, { buffer, mime })
      })
      const respostas = Promise.all([baixar(primeiro.id), baixar(segundo.id)])
      let prazo: ReturnType<typeof setTimeout> | undefined
      try {
        await Promise.race([
          iniciados,
          new Promise((_, reject) => {
            prazo = setTimeout(
              () => reject(new Error('Uploads independentes serializados')),
              2000,
            )
          }),
        ])
      } finally {
        clearTimeout(prazo)
        liberar()
        expect((await respostas).map((r) => r.status)).toEqual([200, 200])
      }
      expect(storage.salvar).toHaveBeenCalledTimes(2)
    },
  )

  it('classifica vencimento nulo, futuro e passado sem inventar prazo', async () => {
    await pagamento({ valor: '10.00' })
    await pagamento({
      valor: '20.00',
      vencimento: new Date(Date.now() + 86400000).toISOString(),
    })
    const vencido = await pagamento({
      valor: '30.00',
      vencimento: new Date(Date.now() - 86400000).toISOString(),
    })
    await pagamento({ valor: '40.00', status: 'PAGO' })
    expect(await resumo()).toEqual({
      total_recebido: '40.00',
      total_a_receber: '30.00',
      total_pendente: '30.00',
    })
    await baixar(vencido.id).expect(200)
    expect(await resumo()).toEqual({
      total_recebido: '70.00',
      total_a_receber: '30.00',
      total_pendente: '0',
    })
  })
  it('separa a receber de atrasado com margem de uma hora (#78)', async () => {
    // Margens de ±24h escondem qualquer deslocamento de fuso de poucas horas:
    // 1h pin a fronteira exata do contrato (fim do dia no fuso do app).
    await pagamento({
      valor: '10.00',
      vencimento: new Date(Date.now() + 3600000).toISOString(),
    })
    await pagamento({
      valor: '20.00',
      vencimento: new Date(Date.now() - 3600000).toISOString(),
    })
    expect(await resumo()).toEqual({
      total_recebido: '0',
      total_a_receber: '10.00',
      total_pendente: '20.00',
    })
  })
  it('nega baixa futura, fora do escopo e em objetos excluídos ou cancelados', async () => {
    const futuro = await pagamento({ futuro: true })
    await baixar(futuro.id).expect(409)
    const outro = await pagamento({ instituicao: outraInstituicao })
    await baixar(outro.id).expect(404)
    const cancelado = await pagamento()
    await db.query("UPDATE plantoes SET status = 'CANCELADO' WHERE id = $1", [
      cancelado.plantao,
    ])
    await baixar(cancelado.id).expect(404)
    const excluido = await pagamento()
    await db.query('UPDATE pagamentos SET deleted_at = now() WHERE id = $1', [
      excluido.id,
    ])
    await baixar(excluido.id).expect(404)
    await baixar('00000000-0000-4000-8000-000000000000').expect(404)
    expect(storage.salvar).not.toHaveBeenCalled()
  })
  it('nega comprovante pendente, inexistente, ausente e de outro médico', async () => {
    const pendente = await pagamento()
    await comprovante(pendente.id, medico).expect(404)
    const pago = await pagamento({ status: 'PAGO' })
    await comprovante(pago.id, medico).expect(404)
    await comprovante('00000000-0000-4000-8000-000000000000', medico).expect(
      404,
    )
    await baixar(pendente.id).expect(200)
    await comprovante(pendente.id, outroMedico).expect(404)
    objetos.clear()
    await comprovante(pendente.id, medico).expect(404)
    await db.query('UPDATE plantoes SET deleted_at = now() WHERE id = $1', [
      pendente.plantao,
    ])
    await comprovante(pendente.id, medico).expect(404)
  })
  it.each([
    [pdf, 'a.pdf', 'application/pdf'],
    [jpeg, 'a.jpeg', 'image/jpeg'],
    [png, 'a.png', 'image/png'],
  ] as const)('aceita formato permitido %s', async (buffer, nome, mime) => {
    const p = await pagamento()
    await baixar(p.id, gestor, buffer, nome, mime).expect(200)
    expect(storage.salvar).toHaveBeenCalledWith(
      expect.any(String),
      buffer,
      mime,
    )
  })
  it('valida campo, extensão, MIME, assinatura e limite de tamanho', async () => {
    const p = await pagamento()
    await request(app.getHttpServer())
      .post(`/financeiro/pagamentos/${p.id}/dar-baixa`)
      .set('Authorization', gestor)
      .expect(400)
    for (const [buffer, nome, mime] of [
      [pdf, 'a.txt', 'application/pdf'],
      [pdf, 'a.pdf', 'image/png'],
      [Buffer.from('não é PDF'), 'a.pdf', 'application/pdf'],
      [jpeg, 'a.png', 'image/png'],
      [Buffer.alloc(0), 'a.pdf', 'application/pdf'],
    ] as const)
      await baixar(p.id, gestor, buffer, nome, mime).expect(400)
    const exato = Buffer.alloc(limite, 0x20)
    pdf.copy(exato)
    Buffer.from('%%EOF').copy(exato, limite - 5)
    await baixar(p.id, gestor, Buffer.concat([exato, Buffer.from('x')])).expect(
      413,
    )
    await baixar(p.id, gestor, exato).expect(200)
  })
  it('falha de upload não marca pago e preserva objeto incerto para reconciliação', async () => {
    const p = await pagamento()
    storage.salvar.mockImplementationOnce(async (chave, buffer, mime) => {
      objetos.set(chave, { buffer, mime })
      throw new ServiceUnavailableException()
    })
    await baixar(p.id).expect(503)
    expect(
      (
        await db.query<{ status: string; comprovante_chave: string | null }>(
          'SELECT status, comprovante_chave FROM pagamentos WHERE id = $1',
          [p.id],
        )
      ).rows[0],
    ).toEqual({ status: 'PENDENTE', comprovante_chave: null })
    expect(storage.remover).not.toHaveBeenCalled()
    expect(objetos.size).toBe(1)
  })
  it('falha reportada após commit preserva comprovante já referenciado', async () => {
    const p = await pagamento()
    const provider = app.get<{
      transaction: (...args: unknown[]) => Promise<unknown>
    }>(DRIZZLE_DB)
    const original = provider.transaction.bind(provider)
    const espiao = vi
      .spyOn(provider, 'transaction')
      .mockImplementationOnce(async (...args) => {
        await original(...args)
        throw new Error('Conexão perdida após commit')
      })
    try {
      await baixar(p.id).expect(500)
      expect(storage.remover).not.toHaveBeenCalled()
      expect(objetos.size).toBe(1)
      const linha = (
        await db.query<{ status: string }>(
          'SELECT status FROM pagamentos WHERE id = $1',
          [p.id],
        )
      ).rows[0]
      expect(linha.status).toBe('PAGO')
      expect((await comprovante(p.id, medico).expect(200)).body).toEqual(pdf)
    } finally {
      espiao.mockRestore()
    }
  })
  it('rollback após upload remove objeto e preserva pagamento pendente', async () => {
    const p = await pagamento()
    await db.exec(
      `CREATE FUNCTION rejeitar_baixa_teste() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'falha de banco'; END $$; CREATE TRIGGER rejeitar_baixa_teste BEFORE UPDATE ON pagamentos FOR EACH ROW EXECUTE FUNCTION rejeitar_baixa_teste()`,
    )
    try {
      await baixar(p.id).expect(500)
      expect(
        (
          await db.query<{ status: string }>(
            'SELECT status FROM pagamentos WHERE id = $1',
            [p.id],
          )
        ).rows[0].status,
      ).toBe('PENDENTE')
      expect(storage.salvar).toHaveBeenCalledTimes(1)
      expect(storage.remover).toHaveBeenCalledTimes(1)
      expect(objetos.size).toBe(0)
    } finally {
      await db.exec(
        'DROP TRIGGER rejeitar_baixa_teste ON pagamentos; DROP FUNCTION rejeitar_baixa_teste()',
      )
    }
  })
})
