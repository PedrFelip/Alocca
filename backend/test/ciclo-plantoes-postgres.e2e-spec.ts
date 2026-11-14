import type { INestApplication } from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'
import { Test } from '@nestjs/testing'
import { drizzle } from 'drizzle-orm/postgres-js'
import { readFile, readdir } from 'node:fs/promises'
import postgres from 'postgres'
import request from 'supertest'
import { AppModule } from '../src/app.module.ts'
import { criarClientePostgres } from '../src/db/cliente-postgres.ts'
import { DRIZZLE_DB } from '../src/db/db.provider.ts'

// Requer PostgreSQL com CREATEDB; cada execução cria e apaga seu próprio banco.
const adminUrl =
  process.env.E2E_PG_ADMIN ??
  'postgresql://postgres:postgres@127.0.0.1:5432/postgres'
const nomeBanco = `alocca_ciclo_${process.pid}_${Date.now()}`
const url = new URL(adminUrl)
url.pathname = `/${nomeBanco}`
const instante = (minutos: number) =>
  new Date(Date.now() + minutos * 60_000).toISOString()

describe('Ciclo de plantões e datas com PostgreSQL (#91, #77)', () => {
  let admin: postgres.Sql
  let sql: postgres.Sql
  let local: postgres.Sql
  let app: INestApplication
  let gestor: string
  let medico: string
  let estranho: string
  let instituicao: string
  let gestorId: string
  let medicoId: string
  let medicoUsuarioId: string
  let plantao: string

  beforeAll(async () => {
    admin = postgres(adminUrl, { max: 1, connect_timeout: 3 })
    await admin.unsafe(`CREATE DATABASE ${nomeBanco}`)
    await admin.unsafe(
      `ALTER DATABASE ${nomeBanco} SET timezone TO 'America/Sao_Paulo'`,
    )
    local = postgres(url.toString(), { max: 1 })
    sql = criarClientePostgres(url.toString(), { max: 2 })
    for (const dir of (await readdir('drizzle')).sort()) {
      await sql.unsafe(await readFile(`drizzle/${dir}/migration.sql`, 'utf8'))
    }
    const modulo = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(DRIZZLE_DB)
      .useValue(drizzle({ client: sql }))
      .compile()
    app = modulo.createNestApplication()
    await app.init()
  }, 30000)
  afterAll(async () => {
    await app?.close()
    await sql?.end()
    await local?.end()
    if (admin) {
      await admin.unsafe(`DROP DATABASE IF EXISTS ${nomeBanco} WITH (FORCE)`)
      await admin.end()
    }
  })
  beforeEach(async () => {
    await sql`TRUNCATE notificacoes, pagamentos, registros_ponto, alocacoes, candidaturas, plantoes,
      gestores_instituicoes, gestores, instituicoes, medicos, tokens_recuperacao_senha, usuarios CASCADE`
    const usuarios =
      await sql`INSERT INTO usuarios (nome,email,senha_hash,tipo) VALUES
      ('Gestor','gestor@test.local','hash','GESTOR'), ('Outro','outro@test.local','hash','GESTOR'),
      ('Médico','medico@test.local','hash','MEDICO') RETURNING id,nome`
    gestorId = usuarios.find((u) => u.nome === 'Gestor')!.id
    medicoUsuarioId = usuarios.find((u) => u.nome === 'Médico')!.id
    const outroId = usuarios.find((u) => u.nome === 'Outro')!.id
    const [g] =
      await sql`INSERT INTO gestores (usuario_id) VALUES (${gestorId}) RETURNING id`
    await sql`INSERT INTO gestores (usuario_id) VALUES (${outroId})`
    const [m] =
      await sql`INSERT INTO medicos (usuario_id,crm,uf_crm,especialidade)
      VALUES (${medicoUsuarioId},'123456','DF','Clínica Médica') RETURNING id`
    medicoId = m.id
    const [i] =
      await sql`INSERT INTO instituicoes (usuario_id,nome,cnpj,cidade,uf)
      VALUES (${gestorId},'Hospital','11111111000111','Brasília','DF') RETURNING id`
    instituicao = i.id
    await sql`INSERT INTO gestores_instituicoes (gestor_id,instituicao_id) VALUES (${g.id},${instituicao})`
    const [p] =
      await sql`INSERT INTO plantoes (instituicao_id,gestor_criador_id,titulo,local_unidade,
      especialidade,data_inicio,data_fim,valor,quantidade_vagas,vagas_disponiveis,status)
      VALUES (${instituicao},${gestorId},'Plantão','UTI','Clínica Médica',${instante(120)},${instante(240)},1000,2,2,'ABERTO') RETURNING id`
    plantao = p.id
    const jwt = app.get(JwtService)
    gestor = `Bearer ${await jwt.signAsync({ sub: gestorId })}`
    estranho = `Bearer ${await jwt.signAsync({ sub: outroId })}`
    medico = `Bearer ${await jwt.signAsync({ sub: medicoUsuarioId })}`
  })
  async function candidatura(
    status: 'PENDENTE' | 'APROVADA' | 'REJEITADA',
    alocar = false,
  ) {
    const [c] = await sql`INSERT INTO candidaturas (plantao_id,medico_id,status)
      VALUES (${plantao},${medicoId},${status}) RETURNING id`
    if (!alocar) return { candidatura: c.id, alocacao: '' }
    const [a] =
      await sql`INSERT INTO alocacoes (plantao_id,medico_id,candidatura_id)
      VALUES (${plantao},${medicoId},${c.id}) RETURNING id`
    await sql`INSERT INTO pagamentos (alocacao_id,valor) VALUES (${a.id},1000)`
    await sql`UPDATE plantoes SET vagas_disponiveis = 1 WHERE id = ${plantao}`
    return { candidatura: c.id, alocacao: a.id }
  }
  const patch = (body: object) =>
    request(app.getHttpServer())
      .patch(`/plantoes/${plantao}`)
      .set('Authorization', gestor)
      .send(body)
  const transicao = (acao: string) =>
    request(app.getHttpServer())
      .post(`/plantoes/${plantao}/${acao}`)
      .set('Authorization', gestor)

  it('protege operações por autenticação, papel e vínculo institucional', async () => {
    for (const acao of ['editar', 'cancelar', 'concluir']) {
      const fazer = (token?: string) => {
        const req =
          acao === 'editar'
            ? request(app.getHttpServer())
                .patch(`/plantoes/${plantao}`)
                .send({ titulo: 'Alterado' })
            : request(app.getHttpServer()).post(`/plantoes/${plantao}/${acao}`)
        return token ? req.set('Authorization', token) : req
      }
      await fazer().expect(401)
      await fazer(medico).expect(403)
      await fazer(estranho).expect(403)
    }
    const [p] =
      await sql`SELECT titulo,status FROM plantoes WHERE id=${plantao}`
    expect(p).toMatchObject({ titulo: 'Plantão', status: 'ABERTO' })
  })
  it('edita parcialmente sem instituição, valida período e não aceita transferência', async () => {
    const resposta = await patch({ titulo: 'Novo título' }).expect(200)
    expect(resposta.body.plantao).toMatchObject({
      id: plantao,
      titulo: 'Novo título',
      instituicao_id: instituicao,
    })
    await patch({ instituicao_id: instituicao }).expect(400)
    await patch({ data_fim: instante(60) }).expect(400)
    const [p] = await sql`SELECT titulo,valor FROM plantoes WHERE id=${plantao}`
    expect(p).toMatchObject({ titulo: 'Novo título', valor: '1000.00' })
  })
  it.each(['PENDENTE', 'APROVADA'] as const)(
    'RN27 bloqueia datas, valor e especialidade com candidatura %s',
    async (status) => {
      await candidatura(status)
      for (const body of [
        { data_inicio: instante(130) },
        { data_fim: instante(250) },
        { valor: 1200 },
        { especialidade: 'Pediatria' },
        { local_unidade: 'Outro hospital' },
      ])
        await patch(body).expect(409)
      await patch({ titulo: 'Permitido' }).expect(200)
      const [p] =
        await sql`SELECT valor,especialidade FROM plantoes WHERE id=${plantao}`
      expect(p).toMatchObject({
        valor: '1000.00',
        especialidade: 'Clínica Médica',
      })
    },
  )
  it('candidatura rejeitada não impede edição e recalcula vagas ao editar', async () => {
    await candidatura('REJEITADA')
    await patch({ valor: 1300 }).expect(200)
    await sql`DELETE FROM candidaturas WHERE plantao_id=${plantao}`
    await candidatura('APROVADA', true)
    await patch({ quantidade_vagas: 1 }).expect(200)
    await patch({ quantidade_vagas: 2 }).expect(200)
    const [p] =
      await sql`SELECT quantidade_vagas,vagas_disponiveis,status FROM plantoes WHERE id=${plantao}`
    expect(p).toMatchObject({
      quantidade_vagas: 2,
      vagas_disponiveis: 1,
      status: 'ABERTO',
    })
  })
  it('cancelamento rejeita candidatura, remove alocação logicamente e conserva pagamento e outbox', async () => {
    const { candidatura: c, alocacao: a } = await candidatura('APROVADA', true)
    const resposta = await transicao('cancelar').expect(201)
    expect(resposta.body).toMatchObject({
      message: expect.any(String),
      plantao: { id: plantao, status: 'CANCELADO' },
    })
    const [cand] = await sql`SELECT status FROM candidaturas WHERE id=${c}`
    const [aloc] = await sql`SELECT deleted_at FROM alocacoes WHERE id=${a}`
    const [pag] =
      await sql`SELECT status,deleted_at FROM pagamentos WHERE alocacao_id=${a}`
    expect(cand.status).toBe('REJEITADA')
    expect(aloc.deleted_at).not.toBeNull()
    expect(pag).toMatchObject({ status: 'PENDENTE', deleted_at: null })
    const notificacoes =
      await sql`SELECT usuario_destino_id,status FROM notificacoes WHERE plantao_id=${plantao}`
    expect(notificacoes).toContainEqual(
      expect.objectContaining({
        usuario_destino_id: medicoUsuarioId,
        status: 'PENDENTE',
      }),
    )
    await transicao('cancelar').expect(409)
    expect(
      await sql`SELECT id FROM notificacoes WHERE plantao_id=${plantao}`,
    ).toHaveLength(notificacoes.length)
  })
  it.each(['PAGO', 'PRESENCA'] as const)(
    'cancelamento com %s é atômico e bloqueado',
    async (impedimento) => {
      const { candidatura: c, alocacao: a } = await candidatura(
        'APROVADA',
        true,
      )
      if (impedimento === 'PAGO')
        await sql`UPDATE pagamentos SET status='PAGO' WHERE alocacao_id=${a}`
      else
        await sql`INSERT INTO registros_ponto (alocacao_id,tipo_evento) VALUES (${a},'ENTRADA')`
      await transicao('cancelar').expect(409)
      expect(
        (await sql`SELECT status FROM plantoes WHERE id=${plantao}`)[0].status,
      ).toBe('ABERTO')
      expect(
        (await sql`SELECT status FROM candidaturas WHERE id=${c}`)[0].status,
      ).toBe('APROVADA')
      expect(
        (await sql`SELECT deleted_at FROM alocacoes WHERE id=${a}`)[0]
          .deleted_at,
      ).toBeNull()
      expect(
        await sql`SELECT id FROM notificacoes WHERE plantao_id=${plantao}`,
      ).toHaveLength(0)
    },
  )
  it('conclui somente após fim, preservando alocação e pagamento e notificando', async () => {
    const { alocacao: a } = await candidatura('APROVADA', true)
    await transicao('concluir').expect(409)
    await sql`UPDATE plantoes SET data_inicio=${instante(-120)},data_fim=${instante(-60)} WHERE id=${plantao}`
    const resposta = await transicao('concluir').expect(201)
    expect(resposta.body).toMatchObject({
      message: expect.any(String),
      plantao: { id: plantao, status: 'CONCLUIDO' },
    })
    expect(
      (await sql`SELECT deleted_at FROM alocacoes WHERE id=${a}`)[0].deleted_at,
    ).toBeNull()
    expect(
      (
        await sql`SELECT status,deleted_at FROM pagamentos WHERE alocacao_id=${a}`
      )[0],
    ).toMatchObject({ status: 'PENDENTE', deleted_at: null })
    expect(
      await sql`SELECT usuario_destino_id FROM notificacoes WHERE plantao_id=${plantao}`,
    ).toContainEqual(
      expect.objectContaining({ usuario_destino_id: medicoUsuarioId }),
    )
    await transicao('concluir').expect(409)
  })
  it('conclusão rejeita candidaturas pendentes', async () => {
    const { candidatura: c } = await candidatura('PENDENTE')
    await sql`UPDATE plantoes SET data_inicio=${instante(-120)},data_fim=${instante(-60)} WHERE id=${plantao}`
    await transicao('concluir').expect(201)
    expect(
      (await sql`SELECT status FROM candidaturas WHERE id=${c}`)[0].status,
    ).toBe('REJEITADA')
  })
  it('usa UTC no feed e no check-in mesmo com fuso padrão São Paulo', async () => {
    expect((await local`SHOW TimeZone`)[0].TimeZone).toBe('America/Sao_Paulo')
    expect((await sql`SHOW TimeZone`)[0].TimeZone).toBe('UTC')
    await sql`UPDATE plantoes SET data_inicio=${instante(-120)},data_fim=${instante(-60)} WHERE id=${plantao}`
    const feed = await request(app.getHttpServer())
      .get('/plantoes')
      .set('Authorization', medico)
      .expect(200)
    expect(feed.body).not.toContainEqual(
      expect.objectContaining({ id: plantao }),
    )
    await sql`UPDATE plantoes SET data_inicio=${instante(-5)},data_fim=${instante(60)} WHERE id=${plantao}`
    const { alocacao: a } = await candidatura('APROVADA', true)
    await request(app.getHttpServer())
      .post('/presenca')
      .set('Authorization', medico)
      .send({ alocacao_id: a, tipo_evento: 'ENTRADA' })
      .expect(201)
    const [registro] =
      await sql`SELECT timestamp_servidor::text AS hora FROM registros_ponto WHERE alocacao_id=${a}`
    expect(
      Math.abs(
        Date.now() - new Date(`${registro.hora.replace(' ', 'T')}Z`).getTime(),
      ),
    ).toBeLessThan(60_000)
  })
  it('impede reduzir vagas abaixo do número de alocações ativas', async () => {
    await candidatura('APROVADA', true)
    const [u] = await sql`INSERT INTO usuarios (nome,email,senha_hash,tipo)
      VALUES ('Médico 2','medico2@test.local','hash','MEDICO') RETURNING id`
    const [m] =
      await sql`INSERT INTO medicos (usuario_id,crm,uf_crm) VALUES (${u.id},'654321','DF') RETURNING id`
    const [c] = await sql`INSERT INTO candidaturas (plantao_id,medico_id,status)
      VALUES (${plantao},${m.id},'APROVADA') RETURNING id`
    await sql`INSERT INTO alocacoes (plantao_id,medico_id,candidatura_id) VALUES (${plantao},${m.id},${c.id})`
    await sql`UPDATE plantoes SET vagas_disponiveis=0,status='PREENCHIDO' WHERE id=${plantao}`
    await patch({ quantidade_vagas: 1 }).expect(409)
    expect(
      (
        await sql`SELECT quantidade_vagas,vagas_disponiveis,status FROM plantoes WHERE id=${plantao}`
      )[0],
    ).toMatchObject({
      quantidade_vagas: 2,
      vagas_disponiveis: 0,
      status: 'PREENCHIDO',
    })
    await patch({ titulo: 'Lotado editado' }).expect(200)
  })
  it('impede edição e cancelamento após o início e impede transições de estados finais', async () => {
    await sql`UPDATE plantoes SET data_inicio=${instante(-5)},data_fim=${instante(60)} WHERE id=${plantao}`
    await patch({ titulo: 'Tarde' }).expect(409)
    await transicao('cancelar').expect(409)
    for (const status of ['CANCELADO', 'CONCLUIDO']) {
      await sql`UPDATE plantoes SET status=${status},data_inicio=${instante(120)},data_fim=${instante(240)} WHERE id=${plantao}`
      await patch({ titulo: 'Inválido' }).expect(409)
      await transicao('cancelar').expect(409)
      await transicao('concluir').expect(409)
    }
  })
  it('cancelamento também rejeita candidatura pendente e registra notificação', async () => {
    const { candidatura: c } = await candidatura('PENDENTE')
    await transicao('cancelar').expect(201)
    expect(
      (await sql`SELECT status FROM candidaturas WHERE id=${c}`)[0].status,
    ).toBe('REJEITADA')
    expect(
      await sql`SELECT usuario_destino_id,status FROM notificacoes WHERE plantao_id=${plantao}`,
    ).toContainEqual(
      expect.objectContaining({
        usuario_destino_id: medicoUsuarioId,
        status: 'PENDENTE',
      }),
    )
  })
  it('preserva instantes com offset na publicação, edição e feed', async () => {
    const resposta = await request(app.getHttpServer())
      .post('/plantoes')
      .set('Authorization', gestor)
      .send({
        instituicao_id: instituicao,
        local_unidade: 'UTI',
        especialidade: 'Clínica Médica',
        data_inicio: '2035-01-10T09:00:00-03:00',
        data_fim: '2035-01-10T12:00:00-03:00',
        valor: 1000,
        quantidade_vagas: 1,
      })
      .expect(201)
    const id = resposta.body.plantao.id
    expect(new Date(resposta.body.plantao.data_inicio).toISOString()).toBe(
      '2035-01-10T12:00:00.000Z',
    )
    const editada = await request(app.getHttpServer())
      .patch(`/plantoes/${id}`)
      .set('Authorization', gestor)
      .send({ data_fim: '2035-01-10T13:00:00-03:00' })
      .expect(200)
    expect(new Date(editada.body.plantao.data_fim).toISOString()).toBe(
      '2035-01-10T16:00:00.000Z',
    )
    const feed = await request(app.getHttpServer())
      .get('/plantoes')
      .set('Authorization', medico)
      .expect(200)
    const item = feed.body.find((p: { id: string }) => p.id === id)
    expect(item).toBeDefined()
    expect(new Date(item.data_inicio).toISOString()).toBe(
      '2035-01-10T12:00:00.000Z',
    )
    expect(new Date(item.data_fim).toISOString()).toBe(
      '2035-01-10T16:00:00.000Z',
    )
  })
  it('RN21 rejeita e notifica pendentes quando redução de capacidade preenche o plantão', async () => {
    await candidatura('APROVADA', true)
    const [u] = await sql`INSERT INTO usuarios (nome,email,senha_hash,tipo)
      VALUES ('Candidato','candidato@test.local','hash','MEDICO') RETURNING id`
    const [m] =
      await sql`INSERT INTO medicos (usuario_id,crm,uf_crm) VALUES (${u.id},'654321','DF') RETURNING id`
    const [c] =
      await sql`INSERT INTO candidaturas (plantao_id,medico_id) VALUES (${plantao},${m.id}) RETURNING id`
    await patch({ quantidade_vagas: 1 }).expect(200)
    expect(
      (await sql`SELECT status FROM candidaturas WHERE id=${c.id}`)[0].status,
    ).toBe('REJEITADA')
    expect(
      await sql`SELECT tipo FROM notificacoes WHERE usuario_destino_id=${u.id}`,
    ).toEqual([{ tipo: 'CANDIDATURA_REJEITADA' }])
    expect(
      (
        await sql`SELECT status,vagas_disponiveis FROM plantoes WHERE id=${plantao}`
      )[0],
    ).toMatchObject({ status: 'PREENCHIDO', vagas_disponiveis: 0 })
  })
  it('falha na outbox reverte cancelamento, candidatura e alocação', async () => {
    const { candidatura: c, alocacao: a } = await candidatura('APROVADA', true)
    await sql`ALTER TABLE notificacoes ADD CONSTRAINT falha_outbox CHECK (tipo <> 'PLANTAO_CANCELADO')`
    try {
      await transicao('cancelar').expect(500)
      expect(
        (await sql`SELECT status FROM plantoes WHERE id=${plantao}`)[0].status,
      ).toBe('ABERTO')
      expect(
        (await sql`SELECT status FROM candidaturas WHERE id=${c}`)[0].status,
      ).toBe('APROVADA')
      expect(
        (await sql`SELECT deleted_at FROM alocacoes WHERE id=${a}`)[0]
          .deleted_at,
      ).toBeNull()
      expect(await sql`SELECT id FROM notificacoes`).toHaveLength(0)
    } finally {
      await sql`ALTER TABLE notificacoes DROP CONSTRAINT falha_outbox`
    }
  })
  it('cancelamento preserva autoria e instante da aprovação e remove recebíveis ativos', async () => {
    const { candidatura: c } = await candidatura('APROVADA', true)
    const [g] = await sql`SELECT id FROM gestores WHERE usuario_id=${gestorId}`
    await sql`UPDATE candidaturas SET analisado_por_gestor_id=${g.id}, analisado_at='2026-01-01 12:00:00',
      observacao_gestor='Aprovado após análise' WHERE id=${c}`
    await transicao('cancelar').expect(201)
    const [aprovacao] =
      await sql`SELECT analisado_por_gestor_id, analisado_at::text AS hora, observacao_gestor FROM candidaturas WHERE id=${c}`
    expect(aprovacao).toMatchObject({
      analisado_por_gestor_id: g.id,
      hora: '2026-01-01 12:00:00',
      observacao_gestor: 'Aprovado após análise',
    })
    const financeiro = await request(app.getHttpServer())
      .get('/financeiro/medico')
      .set('Authorization', medico)
      .expect(200)
    expect(JSON.stringify(financeiro.body)).not.toContain('1000.00')
  })
  it('aprovação concorrente com cancelamento não deixa alocações ativas no plantão cancelado', async () => {
    const { candidatura: c } = await candidatura('PENDENTE')
    await sql`UPDATE medicos SET status_validacao='APROVADO' WHERE id=${medicoId}`
    const [cancelamento, aprovacao] = await Promise.all([
      transicao('cancelar'),
      request(app.getHttpServer())
        .post(`/plantoes/${plantao}/candidaturas/${c}/aprovar`)
        .set('Authorization', gestor),
    ])
    expect(cancelamento.status).toBe(201)
    expect([201, 409]).toContain(aprovacao.status)
    expect(
      await sql`SELECT id FROM alocacoes WHERE plantao_id=${plantao} AND deleted_at IS NULL`,
    ).toHaveLength(0)
    expect(
      (await sql`SELECT status FROM candidaturas WHERE id=${c}`)[0].status,
    ).toBe('REJEITADA')
  })
  it('check-in concorrente com cancelamento mantém presença ou cancelamento, nunca ambos', async () => {
    const { alocacao: a } = await candidatura('APROVADA', true)
    await sql`UPDATE plantoes SET data_inicio=${instante(5)} WHERE id=${plantao}`
    const [cancelamento, presenca] = await Promise.all([
      transicao('cancelar'),
      request(app.getHttpServer())
        .post('/presenca')
        .set('Authorization', medico)
        .send({ alocacao_id: a, tipo_evento: 'ENTRADA' }),
    ])
    expect([201, 409]).toContain(cancelamento.status)
    expect([201, 404, 409]).toContain(presenca.status)
    const [p] = await sql`SELECT status FROM plantoes WHERE id=${plantao}`
    const registros =
      await sql`SELECT id FROM registros_ponto WHERE alocacao_id=${a}`
    if (p.status === 'CANCELADO') expect(registros).toHaveLength(0)
    else {
      expect(cancelamento.status).toBe(409)
      expect(registros).toHaveLength(1)
    }
  })
})
