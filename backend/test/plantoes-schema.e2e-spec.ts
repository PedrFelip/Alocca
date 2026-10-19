import { PGlite } from '@electric-sql/pglite'
import { readFile, readdir } from 'node:fs/promises'

describe('Schema de plantões e interações do médico', () => {
  let database: PGlite
  let instituicaoId: string
  let gestorId: string
  let medicoId: string
  let plantaoId: string

  beforeAll(async () => {
    database = new PGlite()
    for (const directory of (await readdir('drizzle')).sort()) {
      await database.exec(
        await readFile(`drizzle/${directory}/migration.sql`, 'utf8'),
      )
    }
  }, 30000)

  beforeEach(async () => {
    await database.exec(
      `TRUNCATE pagamentos, registros_ponto, alocacoes, candidaturas, plantoes,
       gestores, instituicoes, medicos, tokens_recuperacao_senha, usuarios CASCADE`,
    )

    const gestorUsuario = await database.query<{ id: string }>(
      "INSERT INTO usuarios (nome, email, senha_hash, tipo) VALUES ('Gestor', 'gestor@example.com', 'hash', 'GESTOR') RETURNING id",
    )
    const medicoUsuario = await database.query<{ id: string }>(
      "INSERT INTO usuarios (nome, email, senha_hash, tipo) VALUES ('Médico', 'medico@example.com', 'hash', 'MEDICO') RETURNING id",
    )
    const instituicao = await database.query<{ id: string }>(
      "INSERT INTO instituicoes (usuario_id, nome, cnpj) VALUES ($1, 'Hospital', '12345678000199') RETURNING id",
      [gestorUsuario.rows[0].id],
    )
    instituicaoId = instituicao.rows[0].id
    const gestor = await database.query<{ id: string }>(
      'INSERT INTO gestores (usuario_id, instituicao_id) VALUES ($1, $2) RETURNING id',
      [gestorUsuario.rows[0].id, instituicaoId],
    )
    gestorId = gestor.rows[0].id
    const medico = await database.query<{ id: string }>(
      "INSERT INTO medicos (usuario_id, crm, uf_crm) VALUES ($1, '123456', 'DF') RETURNING id",
      [medicoUsuario.rows[0].id],
    )
    medicoId = medico.rows[0].id
    const plantao = await database.query<{ id: string }>(
      `INSERT INTO plantoes (instituicao_id, criado_por_gestor_id, titulo,
        data_inicio, data_fim, valor, quantidade_vagas, vagas_disponiveis, status)
       VALUES ($1, $2, 'Plantão', now(), now() + interval '12 hours', '1800.00', 2, 2, 'ABERTO')
       RETURNING id`,
      [instituicaoId, gestorId],
    )
    plantaoId = plantao.rows[0].id
  })

  afterAll(async () => {
    await database?.close()
  })

  async function criarCandidatura(): Promise<string> {
    const result = await database.query<{ id: string }>(
      'INSERT INTO candidaturas (plantao_id, medico_id) VALUES ($1, $2) RETURNING id',
      [plantaoId, medicoId],
    )
    return result.rows[0].id
  }

  function criarPlantao(
    quantidadeVagas: number,
    vagasDisponiveis: number,
    inicio = 'now()',
    fim = "now() + interval '12 hours'",
  ) {
    return database.query(
      `INSERT INTO plantoes (instituicao_id, criado_por_gestor_id, titulo,
        data_inicio, data_fim, valor, quantidade_vagas, vagas_disponiveis, status)
       VALUES ($1, $2, 'Plantão', ${inicio}, ${fim}, '1800.00', $3, $4, 'ABERTO')`,
      [instituicaoId, gestorId, quantidadeVagas, vagasDisponiveis],
    )
  }

  it('aceita candidatura e alocação válidas', async () => {
    const candidaturaId = await criarCandidatura()
    await database.query(
      "INSERT INTO alocacoes (plantao_id, medico_id, candidatura_id, origem) VALUES ($1, $2, $3, 'CANDIDATURA')",
      [plantaoId, medicoId, candidaturaId],
    )
    const total = await database.query<{ count: string }>(
      'SELECT count(*) FROM alocacoes',
    )
    expect(Number(total.rows[0].count)).toBe(1)
  })

  it('impede candidatura duplicada no mesmo plantão', async () => {
    await criarCandidatura()
    await expect(criarCandidatura()).rejects.toThrow()
  })

  it('impede alocação repetida para a mesma candidatura', async () => {
    const candidaturaId = await criarCandidatura()
    await database.query(
      "INSERT INTO alocacoes (plantao_id, medico_id, candidatura_id, origem) VALUES ($1, $2, $3, 'CANDIDATURA')",
      [plantaoId, medicoId, candidaturaId],
    )
    await expect(
      database.query(
        "INSERT INTO alocacoes (plantao_id, medico_id, candidatura_id, origem) VALUES ($1, $2, $3, 'CANDIDATURA')",
        [plantaoId, medicoId, candidaturaId],
      ),
    ).rejects.toThrow()
  })

  it('permite várias alocações sem candidatura na atribuição direta', async () => {
    await database.query(
      "INSERT INTO alocacoes (plantao_id, medico_id, candidatura_id, origem) VALUES ($1, $2, NULL, 'ATRIBUICAO_DIRETA')",
      [plantaoId, medicoId],
    )
    const total = await database.query<{ count: string }>(
      'SELECT count(*) FROM alocacoes WHERE candidatura_id IS NULL',
    )
    expect(Number(total.rows[0].count)).toBe(1)
  })

  it('impede dois registros de ponto para a mesma alocação', async () => {
    const candidaturaId = await criarCandidatura()
    const alocacao = await database.query<{ id: string }>(
      "INSERT INTO alocacoes (plantao_id, medico_id, candidatura_id, origem) VALUES ($1, $2, $3, 'CANDIDATURA') RETURNING id",
      [plantaoId, medicoId, candidaturaId],
    )
    await database.query(
      'INSERT INTO registros_ponto (alocacao_id) VALUES ($1)',
      [alocacao.rows[0].id],
    )
    await expect(
      database.query('INSERT INTO registros_ponto (alocacao_id) VALUES ($1)', [
        alocacao.rows[0].id,
      ]),
    ).rejects.toThrow()
  })

  it('impede dois pagamentos para a mesma alocação', async () => {
    const candidaturaId = await criarCandidatura()
    const alocacao = await database.query<{ id: string }>(
      "INSERT INTO alocacoes (plantao_id, medico_id, candidatura_id, origem) VALUES ($1, $2, $3, 'CANDIDATURA') RETURNING id",
      [plantaoId, medicoId, candidaturaId],
    )
    await database.query(
      "INSERT INTO pagamentos (alocacao_id, valor, status) VALUES ($1, '1800.00', 'PENDENTE')",
      [alocacao.rows[0].id],
    )
    await expect(
      database.query(
        "INSERT INTO pagamentos (alocacao_id, valor, status) VALUES ($1, '1800.00', 'PENDENTE')",
        [alocacao.rows[0].id],
      ),
    ).rejects.toThrow()
  })

  it('rejeita plantão com fim anterior ao início', async () => {
    await expect(
      criarPlantao(1, 1, "now() + interval '12 hours'", 'now()'),
    ).rejects.toThrow()
  })

  it('rejeita vagas disponíveis acima do total', async () => {
    await expect(criarPlantao(1, 2)).rejects.toThrow()
  })

  it('rejeita quantidade de vagas menor que um', async () => {
    await expect(criarPlantao(0, 0)).rejects.toThrow()
  })

  it('rejeita plantão sem instituição válida', async () => {
    await expect(
      database.query(
        `INSERT INTO plantoes (instituicao_id, criado_por_gestor_id, titulo,
          data_inicio, data_fim, valor, quantidade_vagas, vagas_disponiveis, status)
         VALUES ('00000000-0000-0000-0000-000000000000', $1, 'Plantão',
          now(), now() + interval '1 hour', '100.00', 1, 1, 'ABERTO')`,
        [gestorId],
      ),
    ).rejects.toThrow()
  })
})
