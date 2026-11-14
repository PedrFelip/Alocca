import { AlocacaoRepository } from './alocacao.repository.ts'
import { AprovarCandidaturaUseCase } from './aprovar-candidatura.use-case.ts'
import { AcessoInstitucionalService } from '../gestores/acesso-institucional.service.ts'
import { PerfilMedicoService } from '../medicos/perfil-medico.service.ts'
import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common'
import { and, desc, eq, isNull } from 'drizzle-orm'
import { serializarLogCritico } from '../common/log-critico.ts'
import { mensagensOficiais } from '../common/mensagens.ts'
import { DRIZZLE_DB, type Database } from '../db/db.provider.ts'
import {
  candidaturasTable,
  instituicoesTable,
  medicosTable,
  plantoesTable,
  usuariosTable,
} from '../db/schemas/index.ts'
import type {
  CriarCandidatura,
  ListarMinhasCandidaturas,
} from './candidaturas.schemas.ts'

const MSG_SEM_ESPECIALIDADE =
  'Complete a especialidade do perfil para se candidatar a esta vaga.'
const MSG_CRM_NAO_VALIDADO =
  'Seu CRM ainda não foi validado. Aguarde a análise para se candidatar.'
const MSG_CANDIDATURA_ENVIADA = mensagensOficiais['MSG-09']
const MSG_DOUBLE_BOOKING = mensagensOficiais['MSG-10']

@Injectable()
export class CandidaturasService {
  private readonly logger = new Logger(CandidaturasService.name)

  constructor(
    @Inject(DRIZZLE_DB) private readonly db: Database,
    @Inject(PerfilMedicoService) private readonly perfis: PerfilMedicoService,
    @Inject(AcessoInstitucionalService)
    private readonly acesso: AcessoInstitucionalService,
    @Inject(AprovarCandidaturaUseCase)
    private readonly aprovacao: AprovarCandidaturaUseCase,
    @Inject(AlocacaoRepository) private readonly alocacoes: AlocacaoRepository,
  ) {}

  /**
   * UC05 — O médico se candidata a um plantão do feed. Regras: RN13, RN16
   * (MSG-10), RN17 (presença de especialidade), MSG-09.
   * Tudo em transação com travas na ordem consistente (medicos → plantoes →
   * candidaturas) para não permitir inserção que escape da cascata de RN21:
   * uma concorrência com o preenchimento da última vaga bloqueia, reavalia o
   * plantão após o commit do vencedor e só então decide.
   */
  async criar(plantaoId: string, usuarioId: string, dados: CriarCandidatura) {
    return this.db.transaction(async (tx) => {
      // 1ª trava: perfil do médico (também serializa com a aprovação RN16).
      const [medico] = await tx
        .select({
          id: medicosTable.id,
          especialidade: medicosTable.especialidade,
          status_validacao: medicosTable.status_validacao,
        })
        .from(medicosTable)
        .where(
          and(
            eq(medicosTable.usuario_id, usuarioId),
            isNull(medicosTable.deleted_at),
          ),
        )
        .for('update')
        .limit(1)
      if (!medico) throw new NotFoundException('Perfil médico não encontrado')

      // crm pendente ou rejeitado nao se candidata
      if (medico.status_validacao !== 'APROVADO') {
        throw new ForbiddenException(MSG_CRM_NAO_VALIDADO)
      }

      // RN17 — Sem especialidade, não aplica para vagas específicas.
      if (!medico.especialidade) {
        throw new ForbiddenException(MSG_SEM_ESPECIALIDADE)
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
        .for('update', { of: plantoesTable })
        .limit(1)
      if (!plantao) throw new NotFoundException('Plantão não encontrado')
      if (!plantao.instituicao_ativa || plantao.status !== 'ABERTO') {
        throw new ConflictException(
          'Este plantão não está aberto para candidaturas',
        )
      }
      if (!plantao.permite_candidatura) {
        throw new ConflictException('Este plantão não aceita candidaturas')
      }
      if (plantao.vagas_disponiveis <= 0) {
        throw new ConflictException(
          'Não há vagas disponíveis para este plantão',
        )
      }
      if (plantao.data_fim.getTime() <= Date.now()) {
        throw new ConflictException(
          'Este plantão já encerrou o período de candidaturas',
        )
      }

      // RN16 — Double-booking (MSG-10): proteção compartilhada com a aprovação.
      const [conflito] = await this.alocacoes.sobrepoeAlocacao(
        plantao.id,
        medico.id,
        plantao,
        tx,
      )
      if (conflito) throw new ConflictException(MSG_DOUBLE_BOOKING)

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
          })
        // Ação crítica: candidatura registrada.
        this.logger.log(
          serializarLogCritico({
            evento: 'CANDIDATURA_CRIADA',
            plantao_id: plantaoId,
            medico_id: medico.id,
          }),
        )
        return {
          message: MSG_CANDIDATURA_ENVIADA,
          candidatura: criada,
        }
      } catch (erro) {
        // Índice único (plantao_id, medico_id): candidatura repetida.
        const codigo = ((erro as { code?: string }).code ??
          (erro as { cause?: { code?: string } }).cause?.code) as
          | string
          | undefined
        if (codigo === '23505') {
          throw new ConflictException('Você já se candidatou a este plantão')
        }
        throw erro
      }
    })
  }

  async listarMinhas(usuarioId: string, filtros: ListarMinhasCandidaturas) {
    const medicoId = await this.perfis.idDoUsuario(usuarioId)

    const condicoes = [
      eq(candidaturasTable.medico_id, medicoId),
      isNull(candidaturasTable.deleted_at),
      isNull(plantoesTable.deleted_at),
      isNull(instituicoesTable.deleted_at),
    ]
    if (filtros.status) {
      condicoes.push(eq(candidaturasTable.status, filtros.status))
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
      .offset(filtros.offset)
  }

  /** UC11 — Lista as candidaturas de um plantão para o gestor responsável. */
  async listar(plantaoId: string, usuarioId: string) {
    await this.acesso.exigirAcessoPlantao(usuarioId, plantaoId)
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
      .orderBy(candidaturasTable.created_at)
  }

  aprovar(plantaoId: string, candidaturaId: string, usuarioId: string) {
    return this.aprovacao.executar(plantaoId, candidaturaId, usuarioId)
  }
}
