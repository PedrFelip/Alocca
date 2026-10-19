import { PGlite } from '@electric-sql/pglite'
import { readFile, readdir } from 'node:fs/promises'

describe('Schema de plantões e interações do médico', () => {
  let database: PGlite
  let instituicaoId: string
  let gestorUsuarioId: string
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

  afterAll(async () => {
    await database?.close()
  })

  beforeEach(async () => {
    await database.exec(
      `TRUNCATE pagamentos, registros_ponto, alocacoes, candidaturas, plantoes,
       gestores_instituicoes, gestores, instituicoes, medicos,
       tokens_recuperacao_senha, usuarios CASCADE`,
    )

    const gestorUsuario = await database.query<{ id: string }>(
      "INSERT INTO usuarios (nome, email, senha_hash, tipo) VALUES ('Gestor', 'gestor@example.com', 'hash', 'GESTOR') RETURNING id",
    )
    gestorUsuarioId = gestorUsuario.rows[0].id
    const medicoUsuario = await database.query<{ id: string }>(
      "INSERT INTO usuarios (nome, email, senha_hash, tipo) VALUES ('Médico', 'medico@example.com', 'hash', 'MEDICO') RETURNING id",
    )
    const instituicao = await database.query<{ id: string }>(
      "INSERT INTO instituicoes (usuario_id, nome, cnpj) VALUES ($1, 'Hospital', '12345678000199') RETURNING id",
      [gestorUsuarioId],
    )
    instituicaoId = instituicao.rows[0].id
    const gestor = await database.query<{ id: string }>(
      'INSERT INTO gestores (usuario_id) VALUES ($1) RETURNING id',
      [gestorUsuarioId],
    )
    await database.query(
      'INSERT INTO gestores_instituicoes (gestor_id, instituicao_id) VALUES ($1, $2)',
      [gestor.rows[0].id, instituicaoId],
    )
    const medico = await database.query<{ id: string }>(
      "INSERT INTO medicos (usuario_id, crm, uf_crm) VALUES ($1, '123456', 'DF') RETURNING id",
      [medicoUsuario.rows[0].id],
    )
    medicoId = medico.rows[0].id
    const plantao = await database.query<{ id: string }>(
      `INSERT INTO plantoes (instituicao_id, gestor_criador_id, titulo, local_unidade, especialidade,
        data_inicio, data_fim, valor, quantidade_vagas, vagas_disponiveis, status)
       VALUES ($1, $2, 'Plantão', 'UTI', 'Clínica Médica', now(), now() + interval '12 hours', '1800.00', 2, 2, 'ABERTO')
       RETURNING id`,
      [instituicaoId, gestorUsuarioId],
    )
    plantaoId = plantao.rows[0].id
  })

  async function criarCandidatura(): Promise<string> {
    const result = await database.query<{ id: string }>(
      'INSERT INTO candidaturas (plantao_id, medico_id) VALUES ($1, $2) RETURNING id',
      [plantaoId, medicoId],
    )
    return result.rows[0].id
  }

  async function criarAlocacao(): Promise<string> {
    const candidaturaId = await criarCandidatura()
    const result = await database.query<{ id: string }>(
      'INSERT INTO alocacoes (plantao_id, medico_id, candidatura_id) VALUES ($1, $2, $3) RETURNING id',
      [plantaoId, medicoId, candidaturaId],
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
      `INSERT INTO plantoes (instituicao_id, gestor_criador_id, titulo, local_unidade, especialidade,
        data_inicio, data_fim, valor, quantidade_vagas, vagas_disponiveis, status)
       VALUES ($1, $2, 'Plantão', 'UTI', 'Clínica Médica', ${inicio}, ${fim}, '1800.00', $3, $4, 'ABERTO')`,
      [instituicaoId, gestorUsuarioId, quantidadeVagas, vagasDisponiveis],
    )
  }

  it('aceita candidatura e alocação válidas', async () => {
    await criarAlocacao()
    const total = await database.query<{ count: string }>(
      'SELECT count(*) FROM alocacoes',
    )
    expect(Number(total.rows[0].count)).toBe(1)
  })

  it('impede candidatura duplicada no mesmo plantão', async () => {
    await criarCandidatura()
    await expect(criarCandidatura()).rejects.toThrow(
      /candidaturas_plantao_medico_unique/,
    )
  })

  it('impede alocação repetida para a mesma candidatura', async () => {
    await criarAlocacao()
    const [candidatura] = (
      await database.query<{ candidatura_id: string }>(
        'SELECT candidatura_id FROM alocacoes LIMIT 1',
      )
    ).rows
    await expect(
      database.query(
        'INSERT INTO alocacoes (plantao_id, medico_id, candidatura_id) VALUES ($1, $2, $3)',
        [plantaoId, medicoId, candidatura.candidatura_id],
      ),
    ).rejects.toThrow(/alocacoes_candidatura_unique/)
  })

  it('exige candidatura na alocação', async () => {
    await expect(
      database.query(
        'INSERT INTO alocacoes (plantao_id, medico_id, candidatura_id) VALUES ($1, $2, NULL)',
        [plantaoId, medicoId],
      ),
    ).rejects.toThrow(/candidatura_id/)
  })

  it('aceita entrada e saída na mesma alocação e grava sem coordenadas', async () => {
    const alocacaoId = await criarAlocacao()
    await database.query(
      "INSERT INTO registros_ponto (alocacao_id, tipo_evento) VALUES ($1, 'ENTRADA')",
      [alocacaoId],
    )
    await database.query(
      "INSERT INTO registros_ponto (alocacao_id, tipo_evento) VALUES ($1, 'SAIDA')",
      [alocacaoId],
    )
    const eventos = await database.query<{
      tipo_evento: string
      latitude: string | null
    }>(
      'SELECT tipo_evento, latitude FROM registros_ponto WHERE alocacao_id = $1 ORDER BY tipo_evento',
      [alocacaoId],
    )
    expect(eventos.rows).toEqual([
      { tipo_evento: 'ENTRADA', latitude: null },
      { tipo_evento: 'SAIDA', latitude: null },
    ])
  })

  it('impede dois registros do mesmo evento na mesma alocação', async () => {
    const alocacaoId = await criarAlocacao()
    await database.query(
      "INSERT INTO registros_ponto (alocacao_id, tipo_evento) VALUES ($1, 'ENTRADA')",
      [alocacaoId],
    )
    await expect(
      database.query(
        "INSERT INTO registros_ponto (alocacao_id, tipo_evento) VALUES ($1, 'ENTRADA')",
        [alocacaoId],
      ),
    ).rejects.toThrow(/registros_ponto_alocacao_evento_unique/)
  })

  it('impede dois pagamentos para a mesma alocação', async () => {
    const alocacaoId = await criarAlocacao()
    await database.query(
      "INSERT INTO pagamentos (alocacao_id, valor) VALUES ($1, '1800.00')",
      [alocacaoId],
    )
    await expect(
      database.query(
        "INSERT INTO pagamentos (alocacao_id, valor) VALUES ($1, '1800.00')",
        [alocacaoId],
      ),
    ).rejects.toThrow(/pagamentos_alocacao_unique/)
  })

  it('rejeita plantão com fim anterior ao início', async () => {
    await expect(
      criarPlantao(1, 1, "now() + interval '12 hours'", 'now()'),
    ).rejects.toThrow(/plantoes_periodo_check/)
  })

  it('rejeita vagas disponíveis acima do total', async () => {
    await expect(criarPlantao(1, 2)).rejects.toThrow(
      /plantoes_vagas_disponiveis_check/,
    )
  })

  it('rejeita quantidade de vagas menor que um', async () => {
    await expect(criarPlantao(0, 0)).rejects.toThrow(
      /plantoes_quantidade_vagas_check/,
    )
  })

  it('impede deixar vagas disponíveis negativas por UPDATE', async () => {
    await expect(
      database.query(
        'UPDATE plantoes SET vagas_disponiveis = -1 WHERE id = $1',
        [plantaoId],
      ),
    ).rejects.toThrow(/plantoes_vagas_disponiveis_check/)
  })

  it('rejeita plantão sem instituição válida', async () => {
    await expect(
      database.query(
        `INSERT INTO plantoes (instituicao_id, gestor_criador_id, titulo, local_unidade, especialidade,
          data_inicio, data_fim, valor, quantidade_vagas, vagas_disponiveis, status)
         VALUES ('00000000-0000-0000-0000-000000000000', $1, 'Plantão', 'UTI', 'Clínica Médica',
          now(), now() + interval '1 hour', '100.00', 1, 1, 'ABERTO')`,
        [gestorUsuarioId],
      ),
    ).rejects.toThrow(/plantoes_instituicao_id/)
  })

  it('exige local de unidade e especialidade no plantão', async () => {
    await expect(
      database.query(
        `INSERT INTO plantoes (instituicao_id, gestor_criador_id, titulo,
          data_inicio, data_fim, valor, quantidade_vagas, vagas_disponiveis, status)
         VALUES ($1, $2, 'Plantão', now(), now() + interval '1 hour', '100.00', 1, 1, 'ABERTO')`,
        [instituicaoId, gestorUsuarioId],
      ),
    ).rejects.toThrow(/local_unidade/)
  })

  it('não aceita alocação cujo plantão/médico não batem com a candidatura', async () => {
    const candidaturaId = await criarCandidatura()
    const outroPlantao = await database.query<{ id: string }>(
      `INSERT INTO plantoes (instituicao_id, gestor_criador_id, titulo, local_unidade, especialidade,
        data_inicio, data_fim, valor, quantidade_vagas, vagas_disponiveis, status)
       VALUES ($1, $2, 'Outro', 'UTI', 'Clínica Médica', now(), now() + interval '1 hour', '100.00', 1, 1, 'ABERTO')
       RETURNING id`,
      [instituicaoId, gestorUsuarioId],
    )
    await expect(
      database.query(
        'INSERT INTO alocacoes (plantao_id, medico_id, candidatura_id) VALUES ($1, $2, $3)',
        [outroPlantao.rows[0].id, medicoId, candidaturaId],
      ),
    ).rejects.toThrow(/alocacoes_candidatura_vinculo_fkey/)

    const outroMedico = await database.query<{ id: string }>(
      `INSERT INTO usuarios (nome, email, senha_hash, tipo)
       VALUES ('Outro', 'outro@example.com', 'hash', 'MEDICO') RETURNING id`,
    )
    const outroMedicoId = await database.query<{ id: string }>(
      "INSERT INTO medicos (usuario_id, crm, uf_crm) VALUES ($1, '654321', 'SP') RETURNING id",
      [outroMedico.rows[0].id],
    )
    await expect(
      database.query(
        'INSERT INTO alocacoes (plantao_id, medico_id, candidatura_id) VALUES ($1, $2, $3)',
        [plantaoId, outroMedicoId.rows[0].id, candidaturaId],
      ),
    ).rejects.toThrow(/alocacoes_candidatura_vinculo_fkey/)
  })
})
