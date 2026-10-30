import { PGlite } from "@electric-sql/pglite";
import type { INestApplication } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { vi } from "vitest";
import { Test } from "@nestjs/testing";
import { drizzle } from "drizzle-orm/pglite";
import { readFile, readdir } from "node:fs/promises";
import request from "supertest";
import { AuthService } from "../src/auth/auth.service.ts";
import { AppModule } from "../src/app.module.ts";
import { DRIZZLE_DB } from "../src/db/db.provider.ts";

const cadastro = {
  nome: "Dra. Ana",
  cpf: "529.982.247-25",
  email: "ana@example.com",
  senha: "Senha-Segura-123",
  crm: "123456",
  uf_crm: "sp",
  especialidade: "Clínica médica",
};

describe("Formato de erros MSG-XX (filtro global)", () => {
  let app: INestApplication;
  let database: PGlite;
  let medicoToken: string;
  let instituicaoId: string;
  let gestorId: string;

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
          ('Gestor Um', 'gestor1@example.com', 'hash', 'GESTOR')
         RETURNING id, nome`,
      )
    ).rows;
    const usuario = (nome: string) => usuarios.find((u) => u.nome === nome)!;
    gestorId = usuario("Gestor Um").id;

    await database.query(
      "INSERT INTO medicos (usuario_id, crm, uf_crm, especialidade) SELECT id, '123456', 'DF', 'Clínica Médica' FROM usuarios WHERE nome = 'Médico Um'",
    );
    instituicaoId = (
      await database.query<{ id: string }>(
        "INSERT INTO instituicoes (usuario_id, nome, cnpj, cidade, uf) VALUES ($1, $2, $3, $4, $5) RETURNING id",
        [gestorId, "Hospital Teste", "11111111000111", "Brasília", "DF"],
      )
    ).rows[0].id;

    const jwt = app.get(JwtService);
    medicoToken = `Bearer ${await jwt.signAsync({ sub: usuario("Médico Um").id })}`;
  });

  afterAll(async () => {
    await app?.close();
    await database?.close();
  });

  it("401 de login carrega MSG-01", async () => {
    const resposta = await request(app.getHttpServer())
      .post("/auth/login")
      .send({ email: "medico1@example.com", senha: "errada" })
      .expect(401);
    expect(resposta.body).toMatchObject({
      code: "MSG-01",
      message: "E-mail, CPF, CRM ou senha incorretos.",
      status: 401,
    });
  });

  it("429 de bloqueio carrega MSG-03", async () => {
    for (let i = 0; i < 4; i += 1) {
      await request(app.getHttpServer())
        .post("/auth/login")
        .send({ email: "medico1@example.com", senha: "errada" })
        .expect(401);
    }
    const resposta = await request(app.getHttpServer())
      .post("/auth/login")
      .send({ email: "medico1@example.com", senha: "errada" })
      .expect(429);
    expect(resposta.body).toMatchObject({
      code: "MSG-03",
      status: 429,
    });
  });

  it("409 de duplicidade no cadastro carrega MSG-02", async () => {
    await request(app.getHttpServer())
      .post("/auth/register/medico")
      .send(cadastro)
      .expect(201);
    const resposta = await request(app.getHttpServer())
      .post("/auth/register/medico")
      .send(cadastro)
      .expect(409);
    expect(resposta.body).toMatchObject({ code: "MSG-02", status: 409 });
  });

  it("409 de double-booking carrega MSG-10", async () => {
    const medicoId = (
      await database.query<{ id: string }>(
        "SELECT id FROM medicos WHERE crm = '123456'",
      )
    ).rows[0].id;
    const inicio = new Date(Date.now() + 5 * 86_400_000).toISOString();
    const fim = new Date(Date.now() + 5.5 * 86_400_000).toISOString();

    for (const _ of [1, 2]) {
      await database.query(
        `INSERT INTO plantoes (instituicao_id, gestor_criador_id, titulo, local_unidade,
          especialidade, data_inicio, data_fim, valor, quantidade_vagas,
          vagas_disponiveis, status)
         VALUES ($1, $2, 'Sobreposto', 'UTI', 'Clínica Médica', $3, $4, '1000.00', 1, 1, 'ABERTO')`,
        [instituicaoId, gestorId, inicio, fim],
      );
    }
    const plantoes = (
      await database.query<{ id: string }>(
        "SELECT id FROM plantoes WHERE titulo = 'Sobreposto' ORDER BY id",
      )
    ).rows;

    const aprovavel = (
      await database.query<{ id: string }>(
        "INSERT INTO candidaturas (plantao_id, medico_id, status) VALUES ($1, $2, $3) RETURNING id",
        [plantoes[0].id, medicoId, "APROVADA"],
      )
    ).rows[0];
    await database.query(
      "INSERT INTO alocacoes (plantao_id, medico_id, candidatura_id) VALUES ($1, $2, $3)",
      [plantoes[0].id, medicoId, aprovavel.id],
    );

    const candidatura = (
      await request(app.getHttpServer())
        .post(`/plantoes/${plantoes[1].id}/candidaturas`)
        .set("Authorization", medicoToken)
        .send()
        .expect(409)
    ).body;
    expect(candidatura).toMatchObject({
      code: "MSG-10",
      message:
        "Conflito de agenda: você já possui um plantão confirmado neste horário.",
      status: 409,
    });
  });

  it("erros sem mensagem oficial não recebem code, mas mantém message e status", async () => {
    const resposta = await request(app.getHttpServer())
      .post("/plantoes/00000000-0000-4000-8000-000000000001/candidaturas")
      .set("Authorization", medicoToken)
      .send()
      .expect(404);
    expect(resposta.body.message).toBe("Plantão não encontrado");
    expect(resposta.body.status).toBe(404);
    expect(resposta.body.code).toBeUndefined();
  });

  it("validação Zod mantém errors e inclui status", async () => {
    const resposta = await request(app.getHttpServer())
      .post("/auth/login")
      .send({ email: "email-invalido" })
      .expect(400);
    expect(resposta.body.message).toBe("Dados inválidos");
    expect(resposta.body.errors).toBeDefined();
    expect(resposta.body.status).toBe(400);
  });

  it("corpo acima do limite do parser retorna 413, não 500", async () => {
    const resposta = await request(app.getHttpServer())
      .post("/auth/login")
      .send({ email: "medico1@example.com", senha: "x".repeat(200_000) })
      .expect(413);
    expect(resposta.body).toMatchObject({ statusCode: 413, status: 413 });
  });

  it("erro inesperado retorna 500 genérico sem expor detalhes", async () => {
    vi.spyOn(app.get(AuthService), "login").mockRejectedValueOnce(
      new Error("detalhe interno"),
    );
    const resposta = await request(app.getHttpServer())
      .post("/auth/login")
      .send({ email: "medico1@example.com", senha: "qualquer" })
      .expect(500);
    expect(resposta.body).toEqual({
      statusCode: 500,
      message: "Internal server error",
      status: 500,
    });
  });
});
