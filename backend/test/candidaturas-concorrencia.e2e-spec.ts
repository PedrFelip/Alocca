import { drizzle } from 'drizzle-orm/postgres-js'
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import postgres from 'postgres'
import { CandidaturasService } from '../src/candidaturas/candidaturas.service.ts'

/**
 * Cenários de concorrência (review do PR): aprovações simultâneas do mesmo
 * médico, disputa candidatura × fechamento da última vaga e rollback.
 * Exigem conexões independendentes de PostgreSQL — PGlite não compartilha
 * estado entre instâncias. Roda com o banco local (compose) ou com o serviço
 * provisionado no CI; sem servidor acessível, a suit é saltada.
 *
 * O banco usado é uma cópia efêmera (CREATE/DROP por execução) — os bancos
 * `alocca_e2e_conc_*` remanescentes de execuções com falha podem ser limpos
 * com `DROP DATABASE`.
 */

function ts(dias: number): string {
  return new Date(Date.now() + dias * 86_400_000).toISOString().slice(0, 23)
}

const URL_ADMIN =
  process.env.E2E_PG_ADMIN ??
  'postgresql://postgres:postgres@127.0.0.1:5432/postgres'

let disponivel = false
try {
  const sonda = postgres(URL_ADMIN, { max: 1, connect_timeout: 3 })
  await sonda`select 1`
  await sonda.end()
  disponivel = true
} catch {
  // Sem PostgreSQL real acessível: o CI provisiona serviços.
}

const describeConcorrencia = disponivel ? describe : describe.skip

describeConcorrencia(
  'Candidaturas/alocação — concorrência com conexões independentes',
  () => {
    const nomeBanco = `alocca_e2e_conc_${Date.now().toString(36)}`
    let admin: postgres.Sql
    const conexoes: postgres.Sql[] = []
    let gestorUsuarioId: string
    let medico1UsuarioId: string
    let medico2UsuarioId: string
    let medico1Id: string

    function urlBanco(): string {
      return URL_ADMIN.replace(/\/postgres$/, `/${nomeBanco}`)
    }

    function servicoEm(): CandidaturasService {
      const conexao = postgres(urlBanco(), { max: 2 })
      conexoes.push(conexao)
      return new CandidaturasService(drizzle({ client: conexao as never }))
    }

    function aprovar(service: CandidaturasService, plantaoId: string, candidaturaId: string) {
      return service.aprovar(plantaoId, candidaturaId, gestorUsuarioId)
    }

    beforeAll(async () => {
      admin = postgres(URL_ADMIN, { max: 1 })
      await admin.unsafe(`CREATE DATABASE ${nomeBanco}`)
      const conexaoMigracao = postgres(urlBanco(), { max: 1 })
      conexoes.push(conexaoMigracao)
      await migrate(drizzle({ client: conexaoMigracao as never }), {
        migrationsFolder: 'drizzle',
      })
    }, 60000)

    beforeEach(async () => {
      const base = postgres(urlBanco(), { max: 2 })
      conexoes.push(base)
      await base.unsafe(
        `TRUNCATE notificacoes, pagamentos, registros_ponto, alocacoes,
         candidaturas, plantoes, gestores_instituicoes, gestores,
         instituicoes, medicos, tokens_recuperacao_senha, usuarios CASCADE`,
      )
      const usuarios = await base.unsafe<{ id: string; nome: string }[]>(
        `INSERT INTO usuarios (nome, email, senha_hash, tipo) VALUES
          ('Médico Um', 'medico1@example.com', 'hash', 'MEDICO'),
          ('Médico Dois', 'medico2@example.com', 'hash', 'MEDICO'),
          ('Gestor', 'gestor@example.com', 'hash', 'GESTOR')
         RETURNING id, nome`,
      )
      gestorUsuarioId = usuarios.find((u) => u.nome === 'Gestor')!.id
      medico1UsuarioId = usuarios.find((u) => u.nome === 'Médico Um')!.id
      medico2UsuarioId = usuarios.find((u) => u.nome === 'Médico Dois')!.id
      const medicos = await base.unsafe<{ id: string; crm: string }[]>(
        `INSERT INTO medicos (usuario_id, crm, uf_crm, especialidade) VALUES
          ($1, '123456', 'DF', 'Clínica Médica'),
          ($2, '654321', 'SP', 'Clínica Médica')
         RETURNING id, crm`,
        [medico1UsuarioId, medico2UsuarioId],
      )
      medico1Id = medicos.find((m) => m.crm === '123456')!.id
      const [instituicao] = await base.unsafe<{ id: string }[]>(
        'INSERT INTO instituicoes (usuario_id, nome, cnpj, cidade, uf) VALUES ($1, $2, $3, $4, $5) RETURNING id',
        [gestorUsuarioId, 'Hospital Conc', '11111111000111', 'Brasília', 'DF'],
      )
      const [gestor] = await base.unsafe<{ id: string }[]>(
        'INSERT INTO gestores (usuario_id) VALUES ($1) RETURNING id',
        [gestorUsuarioId],
      )
      await base.unsafe(
        'INSERT INTO gestores_instituicoes (gestor_id, instituicao_id) VALUES ($1, $2)',
        [gestor.id, instituicao.id],
      )
    }, 30000)

    afterAll(async () => {
      for (const conexao of conexoes) {
        await conexao.end({ timeout: 5 }).catch(() => undefined)
      }
      conexoes.length = 0
      await admin?.end({ timeout: 5 }).catch(() => undefined)
      // O banco efêmero fica para diagnósticos em falhas; remova com
      // `DROP DATABASE` os `alocca_e2e_conc_*` antigos quando precisar.
    })

    it('aprovações simultâneas do mesmo médico em plantões sobrepostos: só uma persiste', async () => {
      const base = postgres(urlBanco(), { max: 2 })
      const plantao1 = (
        await base.unsafe<{ id: string }[]>(
          `INSERT INTO plantoes (instituicao_id, gestor_criador_id, titulo, local_unidade,
            especialidade, data_inicio, data_fim, valor, quantidade_vagas, vagas_disponiveis, status)
           VALUES ((SELECT id FROM instituicoes LIMIT 1), $1, 'Sobreposto A', 'UTI',
                   'Clínica Médica', $2, $3, '1000.00', 2, 2, 'ABERTO') RETURNING id`,
          [gestorUsuarioId, ts(10), ts(11)],
        )
      )[0].id
      const plantao2 = (
        await base.unsafe<{ id: string }[]>(
          `INSERT INTO plantoes (instituicao_id, gestor_criador_id, titulo, local_unidade,
            especialidade, data_inicio, data_fim, valor, quantidade_vagas, vagas_disponiveis, status)
           VALUES ((SELECT id FROM instituicoes LIMIT 1), $1, 'Sobreposto B', 'UTI',
                   'Clínica Médica', $2, $3, '1000.00', 2, 2, 'ABERTO') RETURNING id`,
          [gestorUsuarioId, ts(10.5), ts(12)],
        )
      )[0].id
      await base.unsafe(
        'INSERT INTO candidaturas (plantao_id, medico_id) VALUES ($1, $2), ($3, $2)',
        [plantao1, medico1Id, plantao2],
      )
      const candidaturas = await base.unsafe<
        { id: string; plantao_id: string }[]
      >('SELECT id, plantao_id FROM candidaturas')
      const candidatura1 = candidaturas.find((c) => c.plantao_id === plantao1)!.id
      const candidatura2 = candidaturas.find((c) => c.plantao_id === plantao2)!.id

      const resultados = await Promise.allSettled([
        aprovar(servicoEm(), plantao1, candidatura1),
        aprovar(servicoEm(), plantao2, candidatura2),
      ])
      const atendidas = resultados.filter((r) => r.status === 'fulfilled')
      expect(atendidas).toHaveLength(1)

      const alocacoes = await base.unsafe<{ plantao_id: string }[]>(
        'SELECT plantao_id FROM alocacoes WHERE medico_id = $1',
        [medico1Id],
      )
      expect(alocacoes).toHaveLength(1)

      // A candidatura perdedora permanece PENDENTE no seu próprio plantão.
      const pendentes = await base.unsafe<{ plantao_id: string }[]>(
        "SELECT plantao_id FROM candidaturas WHERE status = 'PENDENTE'",
      )
      expect(pendentes).toHaveLength(1)
      expect(pendentes[0].plantao_id).not.toBe(alocacoes[0].plantao_id)
      await base.end({ timeout: 5 })
    })

    it('candidatura concorrente com fechamento da última vaga: nenhuma PENDENTE escapa da RN21', async () => {
      const base = postgres(urlBanco(), { max: 2 })
      const plantao = (
        await base.unsafe<{ id: string }[]>(
          `INSERT INTO plantoes (instituicao_id, gestor_criador_id, titulo, local_unidade,
            especialidade, data_inicio, data_fim, valor, quantidade_vagas, vagas_disponiveis, status)
           VALUES ((SELECT id FROM instituicoes LIMIT 1), $1, 'Fechando', 'UTI',
                   'Clínica Médica', $2, $3, '1000.00', 1, 1, 'ABERTO') RETURNING id`,
          [gestorUsuarioId, ts(20), ts(20.5)],
        )
      )[0].id
      await base.unsafe(
        'INSERT INTO candidaturas (plantao_id, medico_id) VALUES ($1, $2)',
        [plantao, medico1Id],
      )
      const [candidaturaExistente] = await base.unsafe<{ id: string }[]>(
        'SELECT id FROM candidaturas WHERE plantao_id = $1',
        [plantao],
      )

      await Promise.allSettled([
        aprovar(servicoEm(), plantao, candidaturaExistente.id),
        servicoEm().criar(plantao, medico2UsuarioId, {}),
      ])

      // Seja qual for o vencedor: sem PENDENTE em plantão preenchido,
      // sem segunda alocação, com o plantão fechado na última vaga.
      const pendentes = await base.unsafe<{ id: string }[]>(
        "SELECT id FROM candidaturas WHERE status = 'PENDENTE' AND plantao_id = $1",
        [plantao],
      )
      expect(pendentes).toHaveLength(0)
      const alocacoes = await base.unsafe<{ id: string }[]>(
        'SELECT id FROM alocacoes WHERE plantao_id = $1',
        [plantao],
      )
      expect(alocacoes).toHaveLength(1)
      const [estado] = await base.unsafe<
        { status: string; vagas: number }[]
      >(
        'SELECT status, vagas_disponiveis as vagas FROM plantoes WHERE id = $1',
        [plantao],
      )
      expect(estado.status).toBe('PREENCHIDO')
      expect(Number(estado.vagas)).toBe(0)
      await base.end({ timeout: 5 })
    })

    it('rollback: falha após escrita desfaz alocação, candidatura, vaga e outbox', async () => {
      const base = postgres(urlBanco(), { max: 2 })
      const plantao = (
        await base.unsafe<{ id: string }[]>(
          `INSERT INTO plantoes (instituicao_id, gestor_criador_id, titulo, local_unidade,
            especialidade, data_inicio, data_fim, valor, quantidade_vagas, vagas_disponiveis, status)
           VALUES ((SELECT id FROM instituicoes LIMIT 1), $1, 'Rollback', 'UTI',
                   'Clínica Médica', $2, $3, '1000.00', 2, 2, 'ABERTO') RETURNING id`,
          [gestorUsuarioId, ts(25), ts(25.5)],
        )
      )[0].id
      const candidatura = (
        await base.unsafe<{ id: string }[]>(
          'INSERT INTO candidaturas (plantao_id, medico_id) VALUES ($1, $2) RETURNING id',
          [plantao, medico1Id],
        )
      )[0].id

      // Falha APÓS as primeiras escritas (alocação e candidatura), na
      // inserção do pagamento — dentro da transação do serviço.
      await base.unsafe(
        `CREATE FUNCTION falha_pagamento() RETURNS trigger AS $$
           BEGIN RAISE EXCEPTION 'falha simulada no pagamento'; END;
         $$ LANGUAGE plpgsql`,
      )
      await base.unsafe(
        `CREATE TRIGGER pagamentos_falha
           BEFORE INSERT ON pagamentos
           FOR EACH ROW EXECUTE FUNCTION falha_pagamento()`,
      )

      await expect(aprovar(servicoEm(), plantao, candidatura)).rejects.toThrow()

      expect(
        await base.unsafe('SELECT id FROM alocacoes WHERE candidatura_id = $1', [
          candidatura,
        ]),
      ).toEqual([])
      const [estadoCandidatura] = await base.unsafe<{ status: string }[]>(
        'SELECT status FROM candidaturas WHERE id = $1',
        [candidatura],
      )
      expect(estadoCandidatura.status).toBe('PENDENTE')
      const [plantaoDepois] = await base.unsafe<{ vagas: number }[]>(
        'SELECT vagas_disponiveis as vagas FROM plantoes WHERE id = $1',
        [plantao],
      )
      expect(Number(plantaoDepois.vagas)).toBe(2)
      expect(
        await base.unsafe('SELECT id FROM notificacoes'),
      ).toEqual([])

      await base.unsafe('DROP TRIGGER pagamentos_falha ON pagamentos')
      await base.unsafe('DROP FUNCTION falha_pagamento()')
      await base.end({ timeout: 5 })
    })
  },
)
