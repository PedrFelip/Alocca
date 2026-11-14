import { PGlite } from '@electric-sql/pglite'
import type { INestApplication } from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'
import { Test } from '@nestjs/testing'
import { drizzle } from 'drizzle-orm/pglite'
import { readFile, readdir } from 'node:fs/promises'
import request from 'supertest'
import { AppModule } from '../src/app.module.ts'
import { DRIZZLE_DB } from '../src/db/db.provider.ts'
import { mensagensOficiais } from '../src/common/mensagens.ts'

function timestamp(dias: number): string {
  return new Date(Date.now() + dias * 86_400_000).toISOString().slice(0, 23)
}

describe('UC10 — Publicação de plantões pelo gestor', () => {
  let app: INestApplication
  let database: PGlite
  let gestorUsuarioId: string
  let medicoToken: string
  let gestorToken: string
  let gestorSemPerfilToken: string
  let gestorInativoToken: string
  let adminToken: string
  let instituicaoAtiva: string
  let instituicaoInativa: string
  let instituicaoAlheia: string
  let instituicaoExcluida: string

  beforeAll(async () => {
    database = new PGlite()
    for (const directory of (await readdir('drizzle')).sort()) {
      await database.exec(
        await readFile(`drizzle/${directory}/migration.sql`, 'utf8'),
      )
    }
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(DRIZZLE_DB)
      .useValue(drizzle({ client: database }))
      .compile()
    app = module.createNestApplication()
    await app.init()
  }, 30000)

  beforeEach(async () => {
    await database.exec(
      `TRUNCATE notificacoes, pagamentos, registros_ponto, alocacoes, candidaturas, plantoes,
       gestores_instituicoes, gestores, instituicoes, medicos,
       tokens_recuperacao_senha, usuarios CASCADE`,
    )

    async function criarUsuario(email: string, tipo: string): Promise<string> {
      const result = await database.query<{ id: string }>(
        'INSERT INTO usuarios (nome, email, senha_hash, tipo) VALUES ($1, $2, $3, $4) RETURNING id',
        [tipo, email, 'hash', tipo],
      )
      return result.rows[0].id
    }

    const medicoUsuarioId = await criarUsuario('medico@example.com', 'MEDICO')
    gestorUsuarioId = await criarUsuario('gestor@example.com', 'GESTOR')
    // GESTOR sem linha na tabela `gestores` (perfil incompleto).
    const gestorSemPerfilId = await criarUsuario('gestor-vazio@example.com', 'GESTOR')
    // GESTOR com perfil marcado como inativo.
    const gestorInativoId = await criarUsuario('gestor-inativo@example.com', 'GESTOR')
    const adminUsuarioId = await criarUsuario('admin@example.com', 'ADMIN')
    const gestorAlheioId = await criarUsuario('gestor-alheio@example.com', 'GESTOR')

    await database.query(
      'INSERT INTO gestores (usuario_id) VALUES ($1), ($2)',
      [gestorUsuarioId, gestorAlheioId],
    )
    await database.query(
      'INSERT INTO gestores (usuario_id, ativa) VALUES ($1, false)',
      [gestorInativoId],
    )

    async function criarInstituicao(
      nome: string,
      cnpj: string,
      ativa = true,
    ): Promise<string> {
      const result = await database.query<{ id: string }>(
        'INSERT INTO instituicoes (usuario_id, nome, cnpj, cidade, uf, ativa) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id',
        [gestorUsuarioId, nome, cnpj, 'Brasília', 'DF', ativa],
      )
      return result.rows[0].id
    }

    instituicaoAtiva = await criarInstituicao('Hospital Ativo', '11111111000111')
    instituicaoInativa = await criarInstituicao('Hospital Fechado', '22222222000122', false)
    instituicaoAlheia = await criarInstituicao('Hospital Alheio', '33333333000133')
    // Instituição com soft-delete (deleted_at), vinculada ao gestor logado.
    instituicaoExcluida = await criarInstituicao('Hospital Excluído', '44444444000144')
    await database.query(
      'UPDATE instituicoes SET deleted_at = now() WHERE id = $1',
      [instituicaoExcluida],
    )

    // Vínculos: gestor logado administra Ativo, Fechado e Excluído; Alheio é do gestor-alheio.
    await database.query(
      'INSERT INTO gestores_instituicoes (gestor_id, instituicao_id) SELECT u.id, i.id FROM gestores u, instituicoes i WHERE u.usuario_id = $1 AND i.cnpj IN ($2, $3, $4)',
      [gestorUsuarioId, '11111111000111', '22222222000122', '44444444000144'],
    )
    await database.query(
      'INSERT INTO gestores_instituicoes (gestor_id, instituicao_id) SELECT u.id, i.id FROM gestores u, instituicoes i WHERE u.usuario_id = $1 AND i.cnpj = $2',
      [gestorAlheioId, '33333333000133'],
    )

    await database.query(
      `INSERT INTO plantoes (instituicao_id, gestor_criador_id, titulo, local_unidade, especialidade,
        data_inicio, data_fim, valor, quantidade_vagas, vagas_disponiveis, status)
       VALUES ($1, $2, 'Preenchido existente', 'UTI', 'Clínica Médica', $3, $4, '1000.00', 1, 0, 'PREENCHIDO')`,
      [
        instituicaoAtiva,
        gestorUsuarioId,
        timestamp(-1),
        timestamp(-0.5),
      ],
    )
    await database.query(
      `INSERT INTO plantoes (instituicao_id, gestor_criador_id, titulo, local_unidade, especialidade,
        data_inicio, data_fim, valor, quantidade_vagas, vagas_disponiveis, status)
       VALUES ($1, $2, 'Do gestor alheio', 'UTI', 'Clínica Médica', $3, $4, '1000.00', 1, 1, 'ABERTO')`,
      [
        instituicaoAlheia,
        gestorAlheioId,
        timestamp(1),
        timestamp(1.5),
      ],
    )
    // Plantão com soft-delete na instituição ativa: não pode aparecer no gerenciados.
    await database.query(
      `INSERT INTO plantoes (instituicao_id, gestor_criador_id, titulo, local_unidade, especialidade,
        data_inicio, data_fim, valor, quantidade_vagas, vagas_disponiveis, status, deleted_at)
       VALUES ($1, $2, 'Plantão excluído', 'UTI', 'Clínica Médica', $3, $4, '1000.00', 1, 1, 'ABERTO', now())`,
      [
        instituicaoAtiva,
        gestorUsuarioId,
        timestamp(1),
        timestamp(1.5),
      ],
    )

    const jwt = app.get(JwtService)
    medicoToken = `Bearer ${await jwt.signAsync({ sub: medicoUsuarioId })}`
    gestorToken = `Bearer ${await jwt.signAsync({ sub: gestorUsuarioId })}`
    gestorSemPerfilToken = `Bearer ${await jwt.signAsync({ sub: gestorSemPerfilId })}`
    adminToken = `Bearer ${await jwt.signAsync({ sub: adminUsuarioId })}`
    gestorInativoToken = `Bearer ${await jwt.signAsync({ sub: gestorInativoId })}`
  })

  afterAll(async () => {
    await app?.close()
    await database?.close()
  })

  function criarPlantao(corpo: Record<string, unknown>) {
    return request(app.getHttpServer())
      .post('/plantoes')
      .set('Authorization', gestorToken)
      .send(corpo)
  }

  function corpoValido(): Record<string, unknown> {
    return {
      instituicao_id: instituicaoAtiva,
      local_unidade: 'UTI Adulto — 3º andar',
      especialidade: 'Medicina Intensiva',
      data_inicio: timestamp(2),
      data_fim: timestamp(2.5),
      valor: 1800,
      quantidade_vagas: 2,
    }
  }

  describe('GET /instituicoes/vinculadas', () => {
    it('exige autenticação e papel de gestor', async () => {
      await request(app.getHttpServer()).get('/instituicoes/vinculadas').expect(401)
      for (const token of [medicoToken, adminToken]) {
        await request(app.getHttpServer())
          .get('/instituicoes/vinculadas')
          .set('Authorization', token)
          .expect(403)
      }
    })

    it('lista só as instituições ativas vinculadas ao gestor', async () => {
      const response = await request(app.getHttpServer())
        .get('/instituicoes/vinculadas')
        .set('Authorization', gestorToken)
        .expect(200)
      expect(response.body).toHaveLength(1)
      expect(response.body[0]).toMatchObject({
        id: instituicaoAtiva,
        nome: 'Hospital Ativo',
        cnpj: '11111111000111',
        cidade: 'Brasília',
        uf: 'DF',
      })
    })

    it('gestor sem perfil completo recebe 403', async () => {
      await request(app.getHttpServer())
        .get('/instituicoes/vinculadas')
        .set('Authorization', gestorSemPerfilToken)
        .expect(403)
    })
  })

  describe('POST /plantoes', () => {
    it('exige autenticação e papel de gestor', async () => {
      await request(app.getHttpServer()).post('/plantoes').send(corpoValido()).expect(401)
      for (const token of [medicoToken, adminToken]) {
        await request(app.getHttpServer())
          .post('/plantoes')
          .set('Authorization', token)
          .send(corpoValido())
          .expect(403)
      }
    })

    it('publica o plantão com MSG-14, nascido ABERTO com todas as vagas (RN26)', async () => {
      const response = await criarPlantao({
        ...corpoValido(),
        titulo: 'UTI diurno',
        descricao: 'Requisitos: título de especialista',
      }).expect(201)
      expect(response.body.message).toBe(mensagensOficiais['MSG-14'])
      expect(response.body.plantao).toMatchObject({
        titulo: 'UTI diurno',
        descricao: 'Requisitos: título de especialista',
        local_unidade: 'UTI Adulto — 3º andar',
        especialidade: 'Medicina Intensiva',
        valor: '1800.00',
        quantidade_vagas: 2,
        vagas_disponiveis: 2,
        status: 'ABERTO',
      })
    })

    it('usa título padrão derivado da especialidade quando ausente', async () => {
      const response = await criarPlantao(corpoValido()).expect(201)
      expect(response.body.plantao.titulo).toBe('Plantão de Medicina Intensiva')
    })

    it('rejeita instituição não vinculada ao gestor (RN23)', async () => {
      const response = await criarPlantao({
        ...corpoValido(),
        instituicao_id: instituicaoAlheia,
      }).expect(403)
      expect(response.body.message).toBe('Você não administra esta instituição')
    })

    it('rejeita instituição inexistente', async () => {
      await criarPlantao({
        ...corpoValido(),
        instituicao_id: '00000000-0000-0000-0000-000000000000',
      }).expect(404)
    })

    it('rejeita instituição vinculada porém inativa', async () => {
      const response = await criarPlantao({
        ...corpoValido(),
        instituicao_id: instituicaoInativa,
      }).expect(409)
      expect(response.body.message).toBe('Esta instituição está desativada')
    })

    it('rejeita período inválido com MSG-16 (RN25)', async () => {
      const response = await criarPlantao({
        ...corpoValido(),
        data_inicio: timestamp(3),
        data_fim: timestamp(2),
      }).expect(400)
      expect(response.body.message).toBe(mensagensOficiais['MSG-16'])
      expect(response.body.code).toBe('MSG-16')
    })

    it('rejeita período exatamente igual (fim <= início)', async () => {
      const inicio = timestamp(3)
      await criarPlantao({
        ...corpoValido(),
        data_inicio: inicio,
        data_fim: inicio,
      }).expect(400)
    })

    it('rejeita campos obrigatórios ausentes com MSG-15 (RN24)', async () => {
      for (const campo of [
        'instituicao_id',
        'local_unidade',
        'especialidade',
        'data_inicio',
        'data_fim',
        'valor',
        'quantidade_vagas',
      ]) {
        const corpo = { ...corpoValido() }
        delete corpo[campo]
        const resposta = await criarPlantao(corpo).expect(400)
        expect(resposta.body.message).toBe(mensagensOficiais['MSG-15'])
        expect(resposta.body.code).toBe('MSG-15')
      }
    })

    it('rejeita datas nulas ou inválidas (RN24/RN25)', async () => {
      for (const campo of ['data_inicio', 'data_fim']) {
        await criarPlantao({ ...corpoValido(), [campo]: null }).expect(400)
        await criarPlantao({ ...corpoValido(), [campo]: '' }).expect(400)
        await criarPlantao({ ...corpoValido(), [campo]: 'não é uma data' }).expect(400)
      }
    })

    it('rejeita quantidade de vagas menor que 1 (RN20)', async () => {
      await criarPlantao({ ...corpoValido(), quantidade_vagas: 0 }).expect(400)
      await criarPlantao({ ...corpoValido(), quantidade_vagas: 1.5 }).expect(400)
    })

    it('rejeita valor negativo, zero ou com mais de 2 casas decimais', async () => {
      await criarPlantao({ ...corpoValido(), valor: -100 }).expect(400)
      await criarPlantao({ ...corpoValido(), valor: 0 }).expect(400)
      // 0.001 é positivo, mas gravaria "0.00"; 0.01 é o mínimo válido.
      await criarPlantao({ ...corpoValido(), valor: 0.001 }).expect(400)
      await criarPlantao({ ...corpoValido(), valor: 1800.001 }).expect(400)
      await criarPlantao({ ...corpoValido(), valor: 0.01 }).expect(201)
    })

    it('rejeita corpo com campo desconhecido', async () => {
      await criarPlantao({ ...corpoValido(), campo_extra: true }).expect(400)
    })

    it('rejeita gestor sem perfil ou com perfil inativo', async () => {
      for (const token of [gestorSemPerfilToken, gestorInativoToken]) {
        await request(app.getHttpServer())
          .post('/plantoes')
          .set('Authorization', token)
          .send(corpoValido())
          .expect(403)
      }
    })

    it('rejeita instituição excluída logicamente', async () => {
      await criarPlantao({
        ...corpoValido(),
        instituicao_id: instituicaoExcluida,
      }).expect(404)
    })
  })

  describe('GET /plantoes/gerenciados', () => {
    it('exige autenticação e papel de gestor', async () => {
      await request(app.getHttpServer()).get('/plantoes/gerenciados').expect(401)
      for (const token of [medicoToken, adminToken]) {
        await request(app.getHttpServer())
          .get('/plantoes/gerenciados')
          .set('Authorization', token)
          .expect(403)
      }
    })

    it('lista só plantões das instituições vinculadas, com dados da instituição', async () => {
      const response = await request(app.getHttpServer())
        .get('/plantoes/gerenciados')
        .set('Authorization', gestorToken)
        .expect(200)
      expect(response.body).toHaveLength(1)
      expect(response.body[0]).toMatchObject({
        titulo: 'Preenchido existente',
        status: 'PREENCHIDO',
        instituicao: {
          id: instituicaoAtiva,
          nome: 'Hospital Ativo',
        },
      })
      // Soft-delete: plantão excluído não aparece mesmo estando na instituição ativa.
      expect(response.body).not.toContainEqual(
        expect.objectContaining({ titulo: 'Plantão excluído' }),
      )
    })

    it('filtra por status e instituição', async () => {
      const response = await request(app.getHttpServer())
        .get('/plantoes/gerenciados')
        .query({ status: 'ABERTO' })
        .set('Authorization', gestorToken)
        .expect(200)
      expect(response.body).toHaveLength(0)

      await request(app.getHttpServer())
        .get('/plantoes/gerenciados')
        .query({ instituicao_id: instituicaoAlheia })
        .set('Authorization', gestorToken)
        .expect(200)
        .then((resposta) => expect(resposta.body).toHaveLength(0))
    })

    it('pagina o status filtrado sem repetir ou omitir plantões', async () => {
      for (const [dia, status] of [
        [2, 'ABERTO'],
        [3, 'CANCELADO'],
        [4, 'ABERTO'],
      ] as const) {
        await database.query(
          `INSERT INTO plantoes (instituicao_id, gestor_criador_id, titulo, local_unidade,
            especialidade, data_inicio, data_fim, valor, quantidade_vagas, vagas_disponiveis, status)
           VALUES ($1, $2, $3, 'UTI', 'Clínica Médica', $4, $5, '1000.00', 1, 1, $6)`,
          [
            instituicaoAtiva,
            gestorUsuarioId,
            `Página ${dia}`,
            timestamp(dia),
            timestamp(dia + 0.5),
            status,
          ],
        )
      }
      const titulos: string[] = []
      for (const offset of [0, 1, 2]) {
        const response = await request(app.getHttpServer())
          .get('/plantoes/gerenciados')
          .query({ status: 'ABERTO', limit: 1, offset })
          .set('Authorization', gestorToken)
          .expect(200)
        expect(response.body).toHaveLength(offset < 2 ? 1 : 0)
        for (const plantao of response.body) {
          expect(plantao.status).toBe('ABERTO')
          expect(plantao.instituicao.id).toBe(instituicaoAtiva)
          titulos.push(plantao.titulo)
        }
      }
      expect(titulos.sort()).toEqual(['Página 2', 'Página 4'])
    })

    it('gestor sem perfil completo recebe 403', async () => {
      await request(app.getHttpServer())
        .get('/plantoes/gerenciados')
        .set('Authorization', gestorSemPerfilToken)
        .expect(403)
    })
  })
})
