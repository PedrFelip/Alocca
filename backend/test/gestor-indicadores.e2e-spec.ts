import { PGlite } from '@electric-sql/pglite'
import type { INestApplication } from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'
import { Test } from '@nestjs/testing'
import { drizzle } from 'drizzle-orm/pglite'
import { readFile, readdir } from 'node:fs/promises'
import request from 'supertest'
import { AppModule } from '../src/app.module.ts'
import { DRIZZLE_DB } from '../src/db/db.provider.ts'

describe('GET /gestor/indicadores', () => {
  let app: INestApplication
  let db: PGlite
  let token: string
  let outroToken: string
  let medicoToken: string
  let gestorUsuario: string
  let gestor: string
  let instituicoes: string[]
  let medicos: string[]

  async function id(sql: string, params: unknown[] = []) {
    return (await db.query<{ id: string }>(sql, params)).rows[0]!.id
  }
  const consultar = (bearer = token) =>
    request(app.getHttpServer())
      .get('/gestor/indicadores')
      .set('Authorization', bearer)

  beforeAll(async () => {
    db = new PGlite()
    for (const dir of (await readdir('drizzle')).sort()) {
      await db.exec(await readFile(`drizzle/${dir}/migration.sql`, 'utf8'))
    }
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(DRIZZLE_DB)
      .useValue(drizzle({ client: db }))
      .compile()
    app = module.createNestApplication()
    await app.init()
  }, 30000)

  beforeEach(async () => {
    await db.exec(`TRUNCATE notificacoes, pagamentos, registros_ponto, alocacoes, candidaturas, plantoes,
      gestores_instituicoes, gestores, instituicoes, medicos, tokens_recuperacao_senha, usuarios CASCADE`)
    const usuario = (nome: string, tipo: string) =>
      id(
        'INSERT INTO usuarios (nome, email, senha_hash, tipo) VALUES ($1, $2, $3, $4) RETURNING id',
        [nome, `${nome}@teste.com`, 'hash', tipo],
      )
    gestorUsuario = await usuario('gestor', 'GESTOR')
    const outroUsuario = await usuario('outro', 'GESTOR')
    const m1 = await usuario('medico1', 'MEDICO')
    const m2 = await usuario('medico2', 'MEDICO')
    gestor = await id(
      'INSERT INTO gestores (usuario_id) VALUES ($1) RETURNING id',
      [gestorUsuario],
    )
    const outro = await id(
      'INSERT INTO gestores (usuario_id) VALUES ($1) RETURNING id',
      [outroUsuario],
    )
    medicos = []
    for (const [i, u] of [m1, m2].entries()) {
      medicos.push(
        await id(
          "INSERT INTO medicos (usuario_id, crm, uf_crm) VALUES ($1, $2, 'DF') RETURNING id",
          [u, `${i + 1}`],
        ),
      )
    }
    instituicoes = []
    for (let i = 0; i < 4; i++) {
      const inst = await id(
        'INSERT INTO instituicoes (usuario_id, nome, cnpj, ativa) VALUES ($1, $2, $3, $4) RETURNING id',
        [gestorUsuario, `Hospital ${i}`, `0000000000000${i}`, i !== 2],
      )
      instituicoes.push(inst)
      await db.query(
        'INSERT INTO gestores_instituicoes (gestor_id, instituicao_id) VALUES ($1, $2)',
        [i === 3 ? outro : gestor, inst],
      )
    }
    const jwt = app.get(JwtService)
    token = `Bearer ${await jwt.signAsync({ sub: gestorUsuario })}`
    outroToken = `Bearer ${await jwt.signAsync({ sub: outroUsuario })}`
    medicoToken = `Bearer ${await jwt.signAsync({ sub: m1 })}`
  })

  afterAll(async () => {
    await app?.close()
    await db?.close()
  })

  async function plantao(instituicao = instituicoes[0]) {
    return id(
      `INSERT INTO plantoes (instituicao_id, gestor_criador_id, titulo, local_unidade,
      especialidade, data_inicio, data_fim, valor, quantidade_vagas, vagas_disponiveis, status)
      VALUES ($1, $2, 'Plantão', 'UTI', 'Clínica', '2020-01-01', '2020-01-02', '99.00', 5, 0, 'CONCLUIDO') RETURNING id`,
      [instituicao, gestorUsuario],
    )
  }
  async function alocar(
    p: string,
    m: string,
    valor?: string,
    status = 'PENDENTE',
    vencimento: string | null = null,
  ) {
    const c = await id(
      "INSERT INTO candidaturas (plantao_id, medico_id, status) VALUES ($1, $2, 'APROVADA') RETURNING id",
      [p, m],
    )
    const a = await id(
      'INSERT INTO alocacoes (plantao_id, medico_id, candidatura_id) VALUES ($1, $2, $3) RETURNING id',
      [p, m, c],
    )
    const pagamento = valor
      ? await id(
          'INSERT INTO pagamentos (alocacao_id, valor, status, vencimento_em) VALUES ($1, $2, $3, $4) RETURNING id',
          [a, valor, status, vencimento],
        )
      : undefined
    return { a, pagamento }
  }
  const zeros = {
    plantoes: 0,
    medicos_vinculados: 0,
    vagas_preenchidas: 0,
    pagamentos: { total_pago: '0', total_a_pagar: '0', total_em_atraso: '0' },
  }

  it('exige autenticação e papel de gestor', async () => {
    await request(app.getHttpServer()).get('/gestor/indicadores').expect(401)
    await consultar(medicoToken).expect(403)
    await consultar().expect(200)
  })
  it('retorna estado vazio e timestamp ISO', async () => {
    const resposta = await consultar().expect(200)
    expect(resposta.body).toMatchObject({ periodo: 'todo_historico', ...zeros })
    expect(typeof resposta.body.atualizado_em).toBe('string')
    expect(new Date(resposta.body.atualizado_em).toISOString()).toBe(
      resposta.body.atualizado_em,
    )
  })
  it('agrega histórico, médicos distintos, alocações e centavos sem multiplicar por ponto', async () => {
    const p1 = await plantao()
    const p2 = await plantao(instituicoes[1])
    await plantao()
    const a1 = await alocar(p1, medicos[0], '0.10', 'PAGO')
    await alocar(p1, medicos[1], '0.20')
    const futuro = (
      await db.query<{ data: string }>(
        "SELECT (now() + interval '1 minute')::text AS data",
      )
    ).rows[0]!.data
    await alocar(p2, medicos[0], '123.45', 'PENDENTE', futuro)
    await db.query(
      "INSERT INTO registros_ponto (alocacao_id, tipo_evento) VALUES ($1, 'ENTRADA'), ($1, 'SAIDA')",
      [a1.a],
    )
    const resposta = await consultar().expect(200)
    expect(resposta.body).toMatchObject({
      periodo: 'todo_historico',
      plantoes: 3,
      medicos_vinculados: 2,
      vagas_preenchidas: 3,
      pagamentos: {
        total_pago: '0.10',
        total_a_pagar: '123.65',
        total_em_atraso: '0',
      },
    })
  })
  it('isola gestor e instituições inativas ou excluídas', async () => {
    for (const inst of instituicoes)
      await alocar(await plantao(inst), medicos[0], '10.01', 'PAGO')
    await db.query('UPDATE instituicoes SET deleted_at = now() WHERE id = $1', [
      instituicoes[1],
    ])
    for (const bearer of [token, outroToken]) {
      const resposta = await consultar(bearer).expect(200)
      expect(resposta.body).toMatchObject({
        plantoes: 1,
        medicos_vinculados: 1,
        vagas_preenchidas: 1,
        pagamentos: {
          total_pago: '10.01',
          total_a_pagar: '0',
          total_em_atraso: '0',
        },
      })
    }
  })
  it('separa vencimentos pelo relógio do banco, inclusive sem vencimento', async () => {
    const datas = (
      await db.query<{ passado: string; futuro: string }>(
        "SELECT (now() - interval '1 second')::text AS passado, (now() + interval '1 minute')::text AS futuro",
      )
    ).rows[0]!
    await alocar(await plantao(), medicos[0], '0.01', 'PENDENTE', datas.passado)
    await alocar(await plantao(), medicos[0], '0.02', 'PENDENTE', datas.futuro)
    await alocar(await plantao(), medicos[0], '0.03')
    await alocar(await plantao(), medicos[0], '0.04', 'PAGO', datas.passado)
    const resposta = await consultar().expect(200)
    expect(resposta.body.pagamentos).toEqual({
      total_pago: '0.04',
      total_a_pagar: '0.05',
      total_em_atraso: '0.01',
    })
  })
  it('mantém vencimento igual ao instante de referência no prazo', async () => {
    const { pagamento } = await alocar(await plantao(), medicos[0], '12.34')
    // now() é fixo na transação; a consulta HTTP compartilha esta conexão PGlite.
    await db.exec('BEGIN')
    try {
      await db.query(
        'UPDATE pagamentos SET vencimento_em = now() WHERE id = $1',
        [pagamento],
      )
      const resposta = await consultar().expect(200)
      expect(resposta.body.pagamentos).toEqual({
        total_pago: '0',
        total_a_pagar: '12.34',
        total_em_atraso: '0',
      })
    } finally {
      await db.exec('ROLLBACK')
    }
  })
  it('rejeita gestor inativo ou excluído e usuário bloqueado', async () => {
    await db.query('UPDATE gestores SET ativa = false WHERE id = $1', [gestor])
    await consultar().expect(403)
    await db.query(
      'UPDATE gestores SET ativa = true, deleted_at = now() WHERE id = $1',
      [gestor],
    )
    await consultar().expect(403)
    await db.query('UPDATE gestores SET deleted_at = null WHERE id = $1', [
      gestor,
    ])
    await db.query("UPDATE usuarios SET status = 'BLOQUEADO' WHERE id = $1", [
      gestorUsuario,
    ])
    await consultar().expect(401)
  })
  it('remove acesso após revogação institucional e exclui usuário médico removido', async () => {
    await alocar(await plantao(), medicos[0], '1.23')
    await db.query(
      'UPDATE usuarios SET deleted_at = now() WHERE id = (SELECT usuario_id FROM medicos WHERE id = $1)',
      [medicos[0]],
    )
    expect((await consultar().expect(200)).body).toMatchObject({
      plantoes: 1,
      medicos_vinculados: 0,
      vagas_preenchidas: 0,
      pagamentos: zeros.pagamentos,
    })
    await db.query('DELETE FROM gestores_instituicoes WHERE gestor_id = $1', [
      gestor,
    ])
    expect((await consultar().expect(200)).body).toMatchObject(zeros)
  })
  it('exclui plantões cancelados e registros excluídos em cada nível', async () => {
    const cancelado = await plantao()
    await alocar(cancelado, medicos[0], '10.00')
    await db.query("UPDATE plantoes SET status = 'CANCELADO' WHERE id = $1", [
      cancelado,
    ])
    const excluido = await plantao()
    await alocar(excluido, medicos[0], '10.00')
    await db.query('UPDATE plantoes SET deleted_at = now() WHERE id = $1', [
      excluido,
    ])
    const a = await alocar(await plantao(), medicos[0], '10.00')
    await db.query('UPDATE alocacoes SET deleted_at = now() WHERE id = $1', [
      a.a,
    ])
    await alocar(await plantao(), medicos[1], '10.00')
    await db.query('UPDATE medicos SET deleted_at = now() WHERE id = $1', [
      medicos[1],
    ])
    const c = await alocar(await plantao(), medicos[0], '10.00')
    await db.query('UPDATE pagamentos SET deleted_at = now() WHERE id = $1', [
      c.pagamento,
    ])
    const resposta = await consultar().expect(200)
    expect(resposta.body).toMatchObject({
      plantoes: 3,
      medicos_vinculados: 1,
      vagas_preenchidas: 1,
      pagamentos: { total_pago: '0', total_a_pagar: '0', total_em_atraso: '0' },
    })
  })
})
