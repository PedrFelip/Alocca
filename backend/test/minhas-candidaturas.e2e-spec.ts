import { PGlite } from "@electric-sql/pglite";
import type { INestApplication } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { Test } from "@nestjs/testing";
import { drizzle } from "drizzle-orm/pglite";
import { readFile, readdir } from "node:fs/promises";
import request from "supertest";
import { AppModule } from "../src/app.module.ts";
import { DRIZZLE_DB } from "../src/db/db.provider.ts";

describe("Minhas candidaturas (GET /candidaturas/medico, #49)", () => {
  let app: INestApplication;
  let database: PGlite;
  let medico1Token: string;
  let medico2Token: string;
  let gestorToken: string;
  let adminToken: string;
  let plantaoAberto: string;
  let plantaoUmaVaga: string;
  let medico1Id: string;

  function listar(token: string, query = "") {
    return request(app.getHttpServer())
      .get(`/candidaturas/medico${query}`)
      .set("Authorization", token);
  }

  async function inserirCandidatura(
    plantaoId: string,
    medicoId: string,
    status = "PENDENTE",
  ): Promise<string> {
    const [candidatura] = (
      await database.query<{ id: string }>(
        "INSERT INTO candidaturas (plantao_id, medico_id, status) VALUES ($1, $2, $3) RETURNING id",
        [plantaoId, medicoId, status],
      )
    ).rows;
    return candidatura.id;
  }

  beforeAll(async () => {
    database = new PGlite();
    for (const directory of (await readdir("drizzle")).sort()) {
      await database.exec(
        await readFile(`drizzle/${directory}/migration.sql`, "utf8"),
      );
    }
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(DRIZZLE_DB)
      .useValue(drizzle({ client: database }))
      .compile();
    app = module.createNestApplication();
    await app.init();
  }, 30000);

  beforeEach(async () => {
    await database.exec(
      `TRUNCATE notificacoes, pagamentos, registros_ponto, alocacoes, candidaturas, plantoes,
       gestores_instituicoes, gestores, instituicoes, medicos,
       tokens_recuperacao_senha, usuarios CASCADE`,
    );

    const usuarios = (
      await database.query<{ id: string; nome: string }>(
        `INSERT INTO usuarios (nome, email, senha_hash, tipo) VALUES
          ('Médico Um', 'medico1@example.com', 'hash', 'MEDICO'),
          ('Médico Dois', 'medico2@example.com', 'hash', 'MEDICO'),
          ('Gestor Um', 'gestor1@example.com', 'hash', 'GESTOR'),
          ('Admin', 'admin@example.com', 'hash', 'ADMIN')
         RETURNING id, nome`,
      )
    ).rows;
    const usuario = (nome: string) => usuarios.find((u) => u.nome === nome)!;
    const gestor1 = usuario("Gestor Um");

    await database.query(
      "INSERT INTO medicos (usuario_id, crm, uf_crm, especialidade) SELECT id, '123456', 'DF', 'Clínica Médica' FROM usuarios WHERE nome = 'Médico Um'",
    );
    await database.query(
      "INSERT INTO medicos (usuario_id, crm, uf_crm, especialidade) SELECT id, '654321', 'SP', 'Clínica Médica' FROM usuarios WHERE nome = 'Médico Dois'",
    );
    await database.query(
      "INSERT INTO gestores (usuario_id) SELECT id FROM usuarios WHERE nome = 'Gestor Um'",
    );
    const instituicao = (
      await database.query<{ id: string }>(
        "INSERT INTO instituicoes (usuario_id, nome, cnpj, cidade, uf) VALUES ($1, $2, $3, $4, $5) RETURNING id",
        [gestor1.id, "Hospital Central", "11111111000111", "Brasília", "DF"],
      )
    ).rows[0];

    const criarPlantao = async (
      titulo: string,
      inicio: string,
      fim: string,
    ) => {
      const [plantao] = (
        await database.query<{ id: string }>(
          `INSERT INTO plantoes (instituicao_id, gestor_criador_id, titulo, local_unidade,
            especialidade, data_inicio, data_fim, valor, quantidade_vagas,
            vagas_disponiveis, status)
           VALUES ($1, $2, $3, 'UTI 2', 'Clínica Médica', $4, $5, '1500.00', 2, 2, 'ABERTO')
           RETURNING id`,
          [instituicao.id, gestor1.id, titulo, inicio, fim],
        )
      ).rows;
      return plantao.id;
    };

    plantaoAberto = await criarPlantao(
      "Plantão Noturno",
      new Date(Date.now() + 5 * 86_400_000).toISOString(),
      new Date(Date.now() + 5.5 * 86_400_000).toISOString(),
    );
    plantaoUmaVaga = await criarPlantao(
      "Plantão de Fim de Semana",
      new Date(Date.now() + 10 * 86_400_000).toISOString(),
      new Date(Date.now() + 10.5 * 86_400_000).toISOString(),
    );

    medico1Id = (
      await database.query<{ id: string }>(
        "SELECT id FROM medicos WHERE crm = '123456'",
      )
    ).rows[0].id;

    const jwt = app.get(JwtService);
    medico1Token = `Bearer ${await jwt.signAsync({ sub: usuario("Médico Um").id })}`;
    medico2Token = `Bearer ${await jwt.signAsync({ sub: usuario("Médico Dois").id })}`;
    gestorToken = `Bearer ${await jwt.signAsync({ sub: gestor1.id })}`;
    adminToken = `Bearer ${await jwt.signAsync({ sub: usuario("Admin").id })}`;
  });

  afterAll(async () => {
    await app?.close();
    await database?.close();
  });

  it("exige autenticação (401) e perfil de médico (403)", async () => {
    await request(app.getHttpServer()).get("/candidaturas/medico").expect(401);
    for (const token of [gestorToken, adminToken]) {
      await listar(token).expect(403);
    }
  });

  it("lista as candidaturas do próprio médico com plantão e instituição", async () => {
    await inserirCandidatura(plantaoAberto, medico1Id);
    await inserirCandidatura(plantaoUmaVaga, medico1Id, "REJEITADA");

    const resposta = await listar(medico1Token).expect(200);
    expect(resposta.body).toHaveLength(2);
    expect(resposta.body[0]).toMatchObject({
      status: "REJEITADA",
      mensagem_medico: null,
      plantao: {
        id: plantaoUmaVaga,
        titulo: "Plantão de Fim de Semana",
        especialidade: "Clínica Médica",
        valor: "1500.00",
        local_unidade: "UTI 2",
      },
      instituicao: {
        nome: "Hospital Central",
        cidade: "Brasília",
        uf: "DF",
      },
    });
    expect(new Date(resposta.body[0].criada_em).getTime()).toBeGreaterThan(
      new Date(resposta.body[1].criada_em).getTime(),
    );
  });

  it("REJEITADA permanece visível na lista", async () => {
    await inserirCandidatura(plantaoAberto, medico1Id, "REJEITADA");
    const resposta = await listar(medico1Token).expect(200);
    expect(resposta.body).toHaveLength(1);
    expect(resposta.body[0].status).toBe("REJEITADA");
  });

  it("isola as candidaturas por médico", async () => {
    const medico2Id = (
      await database.query<{ id: string }>(
        "SELECT id FROM medicos WHERE crm = '654321'",
      )
    ).rows[0].id;
    await inserirCandidatura(plantaoAberto, medico2Id);
    await inserirCandidatura(plantaoUmaVaga, medico1Id, "APROVADA");

    const doMedico1 = await listar(medico1Token).expect(200);
    expect(doMedico1.body).toHaveLength(1);
    expect(doMedico1.body[0].plantao.id).toBe(plantaoUmaVaga);

    const doMedico2 = await listar(medico2Token).expect(200);
    expect(doMedico2.body).toHaveLength(1);
    expect(doMedico2.body[0].plantao.id).toBe(plantaoAberto);
  });

  it("filtra por status", async () => {
    await inserirCandidatura(plantaoAberto, medico1Id);
    await inserirCandidatura(plantaoUmaVaga, medico1Id, "APROVADA");

    const pendentes = await listar(medico1Token, "?status=PENDENTE").expect(
      200,
    );
    expect(pendentes.body).toHaveLength(1);
    expect(pendentes.body[0].plantao.id).toBe(plantaoAberto);

    const aprovadas = await listar(medico1Token, "?status=APROVADA").expect(
      200,
    );
    expect(aprovadas.body).toHaveLength(1);
    expect(aprovadas.body[0].plantao.id).toBe(plantaoUmaVaga);

    const rejeitadas = await listar(medico1Token, "?status=REJEITADA").expect(
      200,
    );
    expect(rejeitadas.body).toHaveLength(0);
  });

  it("status inválido retorna 400", async () => {
    await listar(medico1Token, "?status=CANCELADA").expect(400);
  });

  it("pagina com limit e offset", async () => {
    const medico2Id = (
      await database.query<{ id: string }>(
        "SELECT id FROM medicos WHERE crm = '654321'",
      )
    ).rows[0].id;
    await inserirCandidatura(plantaoAberto, medico1Id);
    await inserirCandidatura(plantaoUmaVaga, medico1Id);
    await inserirCandidatura(plantaoAberto, medico2Id);

    const primeira = await listar(medico1Token, "?limit=1&offset=0").expect(
      200,
    );
    expect(primeira.body).toHaveLength(1);

    const segunda = await listar(medico1Token, "?limit=1&offset=1").expect(200);
    expect(segunda.body).toHaveLength(1);
    expect(segunda.body[0].id).not.toBe(primeira.body[0].id);

    const tudo = await listar(medico1Token).expect(200);
    expect(tudo.body).toHaveLength(2);
  });

  it("pagina sem repetir nem omitir itens com created_at igual", async () => {
    const ids = [
      await inserirCandidatura(plantaoAberto, medico1Id),
      await inserirCandidatura(plantaoUmaVaga, medico1Id),
    ];
    await database.query(
      "UPDATE candidaturas SET created_at = '2026-01-01T12:00:00Z' WHERE medico_id = $1",
      [medico1Id],
    );

    const primeira = await listar(medico1Token, "?limit=1&offset=0").expect(
      200,
    );
    const segunda = await listar(medico1Token, "?limit=1&offset=1").expect(200);

    expect([primeira.body[0].id, segunda.body[0].id].sort()).toEqual(
      [...ids].sort(),
    );
  });

  it("médico sem candidaturas recebe lista vazia", async () => {
    const resposta = await listar(medico1Token).expect(200);
    expect(resposta.body).toEqual([]);
  });

  it("candidatura excluída (soft delete) não aparece", async () => {
    const id = await inserirCandidatura(plantaoAberto, medico1Id);
    await database.query(
      "UPDATE candidaturas SET deleted_at = now() WHERE id = $1",
      [id],
    );
    const resposta = await listar(medico1Token).expect(200);
    expect(resposta.body).toEqual([]);
  });
});
