import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { and, desc, eq, gt, inArray, isNull, lt, ne, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { DRIZZLE_DB, type Database } from "../db/db.provider.ts";
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
  usuariosTable,
} from "../db/schemas/index.ts";
import type {
  CriarCandidatura,
  ListarMinhasCandidaturas,
} from "./candidaturas.schemas.ts";

const MSG_CANDIDATURA_ENVIADA =
  "Candidatura enviada com sucesso! Acompanhe o status na sua agenda.";
const MSG_ALOCACAO =
  "Médico alocado com sucesso! Os demais candidatos foram notificados.";
const MSG_DOUBLE_BOOKING =
  "Conflito de agenda: você já possui um plantão confirmado neste horário.";
const MSG_SEM_ESPECIALIDADE =
  "Complete a especialidade do perfil para se candidatar a esta vaga.";

@Injectable()
export class CandidaturasService {
  private readonly logger = new Logger(CandidaturasService.name);

  constructor(@Inject(DRIZZLE_DB) private readonly db: Database) {}

  /**
   * UC05 — O médico se candidata a um plantão do feed. Regras: RN13, RN16
   * (MSG-10), RN17 (presença de especialidade), MSG-09.
   * Tudo em transação com travas na ordem consistente (medicos → plantoes →
   * candidaturas) para não permitir inserção que escape da cascata de RN21:
   * uma concorrência com o preenchimento da última vaga bloqueia, reavalia o
   * plantão após o commit do vencedor e só então decide.
   */
  async criar(plantaoId: string, usuarioId: string, dados: CriarCandidatura) {
    const medicoId = await this.perfilMedicoId(usuarioId);

    return this.db.transaction(async (tx) => {
      // 1ª trava: perfil do médico (também serializa com a aprovação RN16).
      const [medico] = await tx
        .select({
          id: medicosTable.id,
          especialidade: medicosTable.especialidade,
        })
        .from(medicosTable)
        .where(
          and(eq(medicosTable.id, medicoId), isNull(medicosTable.deleted_at)),
        )
        .for("update")
        .limit(1);
      if (!medico) throw new NotFoundException("Perfil médico não encontrado");

      // RN17 — Sem especialidade, não aplica para vagas específicas.
      if (!medico.especialidade) {
        throw new ForbiddenException(MSG_SEM_ESPECIALIDADE);
      }

      const [plantao] = await tx
        .select({
          id: plantoesTable.id,
          status: plantoesTable.status,
          permite_candidatura: plantoesTable.permite_candidatura,
          vagas_disponiveis: plantoesTable.vagas_disponiveis,
          data_inicio: plantoesTable.data_inicio,
          data_fim: plantoesTable.data_fim,
          instituicao_ativa: instituicoesTable.ativa,
        })
        .from(plantoesTable)
        .innerJoin(
          instituicoesTable,
          eq(plantoesTable.instituicao_id, instituicoesTable.id),
        )
        .where(
          and(
            eq(plantoesTable.id, plantaoId),
            isNull(plantoesTable.deleted_at),
            isNull(instituicoesTable.deleted_at),
          ),
        )
        // 2ª trava: plantão — mantém o lock até o INSERT, sem janela entre
        // validação e gravação.
        .for("update", { of: plantoesTable })
        .limit(1);
      if (!plantao) throw new NotFoundException("Plantão não encontrado");
      if (!plantao.instituicao_ativa || plantao.status !== "ABERTO") {
        throw new ConflictException(
          "Este plantão não está aberto para candidaturas",
        );
      }
      if (!plantao.permite_candidatura) {
        throw new ConflictException("Este plantão não aceita candidaturas");
      }
      if (plantao.vagas_disponiveis <= 0) {
        throw new ConflictException(
          "Não há vagas disponíveis para este plantão",
        );
      }
      if (plantao.data_fim.getTime() <= Date.now()) {
        throw new ConflictException(
          "Este plantão já encerrou o período de candidaturas",
        );
      }

      // RN16 — Double-booking (MSG-10): proteção compartilhada com a aprovação.
      const [conflito] = await this.sobrepoeAlocacao(
        plantao.id,
        medico.id,
        plantao,
        tx,
      );
      if (conflito) throw new ConflictException(MSG_DOUBLE_BOOKING);

      try {
        const [criada] = await tx
          .insert(candidaturasTable)
          .values({
            plantao_id: plantaoId,
            medico_id: medico.id,
            mensagem_medico: dados?.mensagem,
          })
          .returning({
            id: candidaturasTable.id,
            plantao_id: candidaturasTable.plantao_id,
            medico_id: candidaturasTable.medico_id,
            status: candidaturasTable.status,
            created_at: candidaturasTable.created_at,
          });
        // Ação crítica: candidatura registrada.
        this.logger.log(
          JSON.stringify({
            evento: "CANDIDATURA_CRIADA",
            plantao_id: plantaoId,
            medico_id: medico.id,
          }),
        );
        return {
          message: MSG_CANDIDATURA_ENVIADA,
          candidatura: criada,
        };
      } catch (erro) {
        // Índice único (plantao_id, medico_id): candidatura repetida.
        const codigo = ((erro as { code?: string }).code ??
          (erro as { cause?: { code?: string } }).cause?.code) as
          string | undefined;
        if (codigo === "23505") {
          throw new ConflictException("Você já se candidatou a este plantão");
        }
        throw erro;
      }
    });
  }

  async listarMinhas(usuarioId: string, filtros: ListarMinhasCandidaturas) {
    const medicoId = await this.perfilMedicoId(usuarioId);

    const condicoes = [
      eq(candidaturasTable.medico_id, medicoId),
      isNull(candidaturasTable.deleted_at),
      isNull(plantoesTable.deleted_at),
      isNull(instituicoesTable.deleted_at),
    ];
    if (filtros.status) {
      condicoes.push(eq(candidaturasTable.status, filtros.status));
    }

    return this.db
      .select({
        id: candidaturasTable.id,
        status: candidaturasTable.status,
        mensagem_medico: candidaturasTable.mensagem_medico,
        criada_em: candidaturasTable.created_at,
        plantao: {
          id: plantoesTable.id,
          titulo: plantoesTable.titulo,
          especialidade: plantoesTable.especialidade,
          data_inicio: plantoesTable.data_inicio,
          data_fim: plantoesTable.data_fim,
          valor: plantoesTable.valor,
          local_unidade: plantoesTable.local_unidade,
        },
        instituicao: {
          id: instituicoesTable.id,
          nome: instituicoesTable.nome,
          cidade: instituicoesTable.cidade,
          uf: instituicoesTable.uf,
        },
      })
      .from(candidaturasTable)
      .innerJoin(
        plantoesTable,
        eq(candidaturasTable.plantao_id, plantoesTable.id),
      )
      .innerJoin(
        instituicoesTable,
        eq(plantoesTable.instituicao_id, instituicoesTable.id),
      )
      .where(and(...condicoes))
      .orderBy(desc(candidaturasTable.created_at), desc(candidaturasTable.id))
      .limit(filtros.limit)
      .offset(filtros.offset);
  }

  /** UC11 — Lista as candidaturas de um plantão para o gestor responsável. */
  async listar(plantaoId: string, usuarioId: string) {
    await this.garantirAcessoGestor(plantaoId, usuarioId);
    return this.db
      .select({
        id: candidaturasTable.id,
        status: candidaturasTable.status,
        mensagem_medico: candidaturasTable.mensagem_medico,
        observacao_gestor: candidaturasTable.observacao_gestor,
        criado_at: candidaturasTable.created_at,
        analisado_at: candidaturasTable.analisado_at,
        medico: {
          id: medicosTable.id,
          nome: usuariosTable.nome,
          crm: medicosTable.crm,
          uf_crm: medicosTable.uf_crm,
          especialidade: medicosTable.especialidade,
        },
      })
      .from(candidaturasTable)
      .innerJoin(medicosTable, eq(candidaturasTable.medico_id, medicosTable.id))
      .innerJoin(usuariosTable, eq(medicosTable.usuario_id, usuariosTable.id))
      .where(
        and(
          eq(candidaturasTable.plantao_id, plantaoId),
          isNull(candidaturasTable.deleted_at),
          isNull(medicosTable.deleted_at),
        ),
      )
      .orderBy(candidaturasTable.created_at);
  }

  /**
   * UC11 — Aprovação de candidatura com alocação do médico (RN20).
   * Tudo roda em transação atômica (spec §6 UC11): alocação → candidatura
   * 'APROVADA' → pagamento 'PENDENTE' → decremento de vaga →, se esgotar,
   * plantão 'PREENCHIDO' + rejeição em cascata das demais candidaturas (RN21)
   * + eventos de notificação gravados na mesma transação (outbox).
   * As travas seguem a ordem consistente medicos → plantoes → candidaturas:
   * a trava do médico serializa aprovações do mesmo profissional, impedindo
   * duas alocações sobrepostas em plantões diferentes.
   */
  async aprovar(plantaoId: string, candidaturaId: string, usuarioId: string) {
    await this.garantirAcessoGestor(plantaoId, usuarioId);
    const gestor = await this.perfilGestor(usuarioId);

    return this.db.transaction(async (tx) => {
      // Leitura inicial sem trava: só para descobrir de quem é a candidatura.
      const [reserva] = await tx
        .select({
          id: candidaturasTable.id,
          medico_id: candidaturasTable.medico_id,
          plantao_id: candidaturasTable.plantao_id,
        })
        .from(candidaturasTable)
        .where(
          and(
            eq(candidaturasTable.id, candidaturaId),
            isNull(candidaturasTable.deleted_at),
          ),
        )
        .limit(1);
      if (!reserva) {
        throw new NotFoundException("Candidatura não encontrada");
      }

      // 1ª trava: médico — dois gestores aprovando o mesmo médico em plantões
      // sobrepostos disputam esta linha; o segundo reavalia a agenda após o
      // commit do primeiro (RN16 a rigor).
      const [medico] = await tx
        .select({ id: medicosTable.id })
        .from(medicosTable)
        .where(
          and(
            eq(medicosTable.id, reserva.medico_id),
            isNull(medicosTable.deleted_at),
          ),
        )
        .for("update")
        .limit(1);
      if (!medico) throw new NotFoundException("Perfil médico não encontrado");

      // 2ª trava: plantão.
      const [plantao] = await tx
        .select({
          id: plantoesTable.id,
          status: plantoesTable.status,
          vagas_disponiveis: plantoesTable.vagas_disponiveis,
          data_inicio: plantoesTable.data_inicio,
          data_fim: plantoesTable.data_fim,
          valor: plantoesTable.valor,
        })
        .from(plantoesTable)
        .where(
          and(
            eq(plantoesTable.id, plantaoId),
            isNull(plantoesTable.deleted_at),
          ),
        )
        .for("update")
        .limit(1);
      if (!plantao) throw new NotFoundException("Plantão não encontrado");
      if (reserva.plantao_id !== plantaoId) {
        throw new NotFoundException("Candidatura não encontrada neste plantão");
      }
      if (plantao.status !== "ABERTO" || plantao.vagas_disponiveis <= 0) {
        throw new ConflictException(
          "Este plantão não está aberto para alocação",
        );
      }

      // 3ª trava: reconfirma estado da candidatura sob lock.
      const [candidatura] = await tx
        .select({
          id: candidaturasTable.id,
          medico_id: candidaturasTable.medico_id,
          status: candidaturasTable.status,
        })
        .from(candidaturasTable)
        .where(eq(candidaturasTable.id, candidaturaId))
        .for("update")
        .limit(1);
      if (candidatura.status !== "PENDENTE") {
        throw new ConflictException("Esta candidatura já foi analisada");
      }

      // RN16 — Double-booking na aprovação: o médico pode ter sido alocado em
      // outro plantão sobreposto após se candidatar.
      const [conflito] = await this.sobrepoeAlocacao(
        plantaoId,
        medico.id,
        plantao,
        tx,
      );
      if (conflito) throw new ConflictException(MSG_DOUBLE_BOOKING);

      // 1. Alocação do médico.
      const [alocacao] = await tx
        .insert(alocacoesTable)
        .values({
          plantao_id: plantaoId,
          medico_id: medico.id,
          candidatura_id: candidaturaId,
        })
        .returning();

      // 2. Candidatura do aprovado.
      await tx
        .update(candidaturasTable)
        .set({
          status: "APROVADA",
          analisado_por_gestor_id: gestor.id,
          analisado_at: new Date(),
        })
        .where(eq(candidaturasTable.id, candidaturaId));

      // 3. Pagamento inicial pendente.
      await tx.insert(pagamentosTable).values({
        alocacao_id: alocacao.id,
        valor: plantao.valor,
        status: "PENDENTE",
        registrado_por_gestor_id: gestor.id,
      });

      // 4. Decremento atômico da vaga (só se ainda houver vaga).
      const [atualizado] = await tx
        .update(plantoesTable)
        .set({
          vagas_disponiveis: sql`${plantoesTable.vagas_disponiveis} - 1`,
        })
        .where(
          and(
            eq(plantoesTable.id, plantaoId),
            gt(plantoesTable.vagas_disponiveis, 0),
          ),
        )
        .returning({
          status: plantoesTable.status,
          quantidade_vagas: plantoesTable.quantidade_vagas,
          vagas_disponiveis: plantoesTable.vagas_disponiveis,
        });
      if (!atualizado) {
        throw new ConflictException(
          "Não há vagas disponíveis para este plantão",
        );
      }
      const preenchido = atualizado.vagas_disponiveis === 0;

      // 5. Notificações em outbox, na mesma transação (UC11; provedor: D10).
      const destinatarios = await this.usuariosPorMedicoId(tx, [
        alocacao.medico_id,
      ]);
      const eventos: Array<{
        usuario_destino_id: string;
        plantao_id: string;
        tipo: string;
      }> = [];
      if (preenchido) {
        // 5a. Plantão esgotado: status 'PREENCHIDO' (RN20).
        await tx
          .update(plantoesTable)
          .set({ status: "PREENCHIDO" })
          .where(eq(plantoesTable.id, plantaoId));
        // 5b. RN21 — Rejeição em cascata dos demais candidatos pendentes.
        const rejeitadas = await tx
          .update(candidaturasTable)
          .set({
            status: "REJEITADA",
            analisado_por_gestor_id: gestor.id,
            analisado_at: new Date(),
          })
          .where(
            and(
              eq(candidaturasTable.plantao_id, plantaoId),
              ne(candidaturasTable.id, candidaturaId),
              eq(candidaturasTable.status, "PENDENTE"),
              isNull(candidaturasTable.deleted_at),
            ),
          )
          .returning({ medico_id: candidaturasTable.medico_id });
        if (rejeitadas.length > 0) {
          const usuariosRejeitados = await this.usuariosPorMedicoId(
            tx,
            rejeitadas.map((c) => c.medico_id),
          );
          eventos.push(
            ...usuariosRejeitados.map((destino) => ({
              usuario_destino_id: destino.usuario_id,
              plantao_id: plantaoId,
              tipo: "CANDIDATURA_REJEITADA",
            })),
          );
        }
      }
      const aprovado = destinatarios.find(
        (d) => d.medico_id === alocacao.medico_id,
      );
      if (aprovado) {
        eventos.push({
          usuario_destino_id: aprovado.usuario_id,
          plantao_id: plantaoId,
          tipo: "ALOCACAO_APROVADA",
        });
      }
      const outbox = await tx
        .insert(notificacoesTable)
        .values(eventos)
        .returning({ id: notificacoesTable.id });

      // Ação crítica: aprovação de alocação (log estruturado, além do outbox).
      this.logger.log(
        JSON.stringify({
          evento: "ALOCACAO_APROVADA",
          plantao_id: plantaoId,
          alocacao_id: alocacao.id,
          plantao_preenchido: preenchido,
          notificacoes: eventos.map((e) => ({
            usuario_destino_id: e.usuario_destino_id,
            tipo: e.tipo,
          })),
          outbox_ids: outbox.map((n) => n.id),
        }),
      );

      return {
        message: MSG_ALOCACAO,
        alocacao: {
          id: alocacao.id,
          plantao_id: alocacao.plantao_id,
          medico_id: alocacao.medico_id,
          candidatura_id: alocacao.candidatura_id,
        },
        plantao: {
          id: plantaoId,
          status: preenchido ? "PREENCHIDO" : atualizado.status,
          quantidade_vagas: atualizado.quantidade_vagas,
          vagas_disponiveis: atualizado.vagas_disponiveis,
        },
      };
    });
  }

  private async usuariosPorMedicoId(
    tx: Parameters<Parameters<Database["transaction"]>[0]>[0],
    medicoIds: string[],
  ) {
    if (medicoIds.length === 0) return [];
    return tx
      .select({
        medico_id: medicosTable.id,
        usuario_id: usuariosTable.id,
      })
      .from(medicosTable)
      .innerJoin(usuariosTable, eq(medicosTable.usuario_id, usuariosTable.id))
      .where(inArray(medicosTable.id, medicoIds));
  }

  private async perfilMedicoId(usuarioId: string) {
    const [medico] = await this.db
      .select({ id: medicosTable.id })
      .from(medicosTable)
      .where(
        and(
          eq(medicosTable.usuario_id, usuarioId),
          isNull(medicosTable.deleted_at),
        ),
      )
      .limit(1);
    if (!medico) throw new NotFoundException("Perfil médico não encontrado");
    return medico.id;
  }

  private async perfilGestor(usuarioId: string) {
    const [gestor] = await this.db
      .select({ id: gestoresTable.id })
      .from(gestoresTable)
      .where(
        and(
          eq(gestoresTable.usuario_id, usuarioId),
          eq(gestoresTable.ativa, true),
          isNull(gestoresTable.deleted_at),
        ),
      )
      .limit(1);
    if (!gestor) {
      throw new ForbiddenException("Perfil de gestor não encontrado");
    }
    return gestor;
  }

  /** Garante que o plantão existe e o gestor o administra. Regra: RN23. */
  private async garantirAcessoGestor(plantaoId: string, usuarioId: string) {
    const [plantao] = await this.db
      .select({
        id: plantoesTable.id,
        gestor_criador_id: plantoesTable.gestor_criador_id,
        instituicao_id: plantoesTable.instituicao_id,
        instituicao_usuario_id: instituicoesTable.usuario_id,
      })
      .from(plantoesTable)
      .innerJoin(
        instituicoesTable,
        eq(plantoesTable.instituicao_id, instituicoesTable.id),
      )
      .where(
        and(
          eq(plantoesTable.id, plantaoId),
          isNull(plantoesTable.deleted_at),
          isNull(instituicoesTable.deleted_at),
        ),
      )
      .limit(1);
    if (!plantao) throw new NotFoundException("Plantão não encontrado");

    const proprietario =
      plantao.gestor_criador_id === usuarioId ||
      plantao.instituicao_usuario_id === usuarioId;

    if (!proprietario) {
      const vinculado = await this.pertenceAEquipeGestor(
        plantao.instituicao_id,
        usuarioId,
      );
      if (!vinculado) {
        throw new ForbiddenException("Você não administra este plantão");
      }
    }
    return plantao;
  }

  private async pertenceAEquipeGestor(
    instituicaoId: string,
    usuarioId: string,
  ): Promise<boolean> {
    const [gestor] = await this.db
      .select({ id: gestoresTable.id })
      .from(gestoresTable)
      .where(
        and(
          eq(gestoresTable.usuario_id, usuarioId),
          eq(gestoresTable.ativa, true),
          isNull(gestoresTable.deleted_at),
        ),
      )
      .limit(1);
    if (!gestor) return false;
    const [vinculo] = await this.db
      .select({ um: sql`1` })
      .from(gestoresInstituicoesTable)
      .where(
        and(
          eq(gestoresInstituicoesTable.gestor_id, gestor.id),
          eq(gestoresInstituicoesTable.instituicao_id, instituicaoId),
        ),
      )
      .limit(1);
    return Boolean(vinculo);
  }

  private sobrepoeAlocacao(
    plantaoId: string,
    medicoId: string,
    plantao: { data_inicio: Date; data_fim: Date },
    banco: Database,
  ) {
    const plantaoConflito = alias(plantoesTable, "plantao_conflito");
    return banco
      .select({ plantao_id: plantaoConflito.id })
      .from(alocacoesTable)
      .innerJoin(
        plantaoConflito,
        eq(alocacoesTable.plantao_id, plantaoConflito.id),
      )
      .where(
        and(
          eq(alocacoesTable.medico_id, medicoId),
          ne(alocacoesTable.plantao_id, plantaoId),
          isNull(alocacoesTable.deleted_at),
          isNull(plantaoConflito.deleted_at),
          // Intervalos semi-abertos: toca nas bordas não é sobreposição.
          lt(plantaoConflito.data_inicio, plantao.data_fim),
          gt(plantaoConflito.data_fim, plantao.data_inicio),
        ),
      )
      .limit(1);
  }
}
