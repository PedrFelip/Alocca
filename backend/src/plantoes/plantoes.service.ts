import { AcessoInstitucionalService } from '../gestores/acesso-institucional.service.ts'
import { PerfilMedicoService } from '../medicos/perfil-medico.service.ts'
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common'
import {
  and,
  asc,
  eq,
  inArray,
  gt,
  gte,
  ilike,
  isNull,
  lte,
  notExists,
  sql,
} from 'drizzle-orm'
import { mensagensOficiais } from '../common/mensagens.ts'
import { GestoresService } from '../gestores/gestores.service.ts'
import { DRIZZLE_DB, type Database } from '../db/db.provider.ts'
import {
  alocacoesTable,
  pagamentosTable,
  registrosPontoTable,
  notificacoesTable,
  candidaturasTable,
  gestoresInstituicoesTable,
  instituicoesTable,
  medicosTable,
  plantoesTable,
} from '../db/schemas/index.ts'
import type {
  CriarPlantao,
  EditarPlantao,
  ListarPlantoes,
  ListarPlantoesGerenciados,
} from './plantoes.schemas.ts'

function trecho(value: string): string {
  return `%${value.replace(/[\\%_]/g, '\\$&')}%`
}

@Injectable()
export class PlantoesService {
  private readonly logger = new Logger(PlantoesService.name)

  constructor(
    @Inject(DRIZZLE_DB) private readonly db: Database,
    @Inject(GestoresService) private readonly gestores: GestoresService,
    @Inject(PerfilMedicoService) private readonly perfis: PerfilMedicoService,
    @Inject(AcessoInstitucionalService)
    private readonly acesso: AcessoInstitucionalService,
  ) {}

  async listar(usuarioId: string, filtros: ListarPlantoes) {
    const medicoId = await this.perfis.idDoUsuario(usuarioId)

    const condicoes = [
      eq(plantoesTable.status, 'ABERTO'),
      eq(plantoesTable.permite_candidatura, true),
      eq(instituicoesTable.ativa, true),
      gt(plantoesTable.vagas_disponiveis, 0),
      gt(plantoesTable.data_inicio, sql`now() AT TIME ZONE 'UTC'`),
      isNull(plantoesTable.deleted_at),
      isNull(instituicoesTable.deleted_at),
      // Não lista plantões em que o próprio médico já se candidatou.
      notExists(
        this.db
          .select({ um: sql`1` })
          .from(candidaturasTable)
          .where(
            and(
              eq(candidaturasTable.plantao_id, plantoesTable.id),
              eq(candidaturasTable.medico_id, medicoId),
            ),
          ),
      ),
    ]
    if (filtros.especialidade) {
      condicoes.push(
        ilike(plantoesTable.especialidade, trecho(filtros.especialidade)),
      )
    }
    if (filtros.cidade) {
      condicoes.push(ilike(instituicoesTable.cidade, trecho(filtros.cidade)))
    }
    if (filtros.uf) {
      condicoes.push(eq(instituicoesTable.uf, filtros.uf))
    }
    if (filtros.valor_min !== undefined) {
      condicoes.push(gte(plantoesTable.valor, String(filtros.valor_min)))
    }
    if (filtros.valor_max !== undefined) {
      condicoes.push(lte(plantoesTable.valor, String(filtros.valor_max)))
    }

    return this.db
      .select({
        id: plantoesTable.id,
        titulo: plantoesTable.titulo,
        descricao: plantoesTable.descricao,
        local_unidade: plantoesTable.local_unidade,
        especialidade: plantoesTable.especialidade,
        data_inicio: plantoesTable.data_inicio,
        data_fim: plantoesTable.data_fim,
        valor: plantoesTable.valor,
        quantidade_vagas: plantoesTable.quantidade_vagas,
        vagas_disponiveis: plantoesTable.vagas_disponiveis,
        exige_checkin: plantoesTable.exige_checkin,
        permite_geolocalizacao: plantoesTable.permite_geolocalizacao,
        instituicao: {
          id: instituicoesTable.id,
          nome: instituicoesTable.nome,
          nome_fantasia: instituicoesTable.nome_fantasia,
          cidade: instituicoesTable.cidade,
          uf: instituicoesTable.uf,
          bairro: instituicoesTable.bairro,
          logradouro: instituicoesTable.logradouro,
        },
      })
      .from(plantoesTable)
      .innerJoin(
        instituicoesTable,
        eq(plantoesTable.instituicao_id, instituicoesTable.id),
      )
      .where(and(...condicoes))
      .orderBy(asc(plantoesTable.data_inicio), asc(plantoesTable.id))
      .limit(filtros.limit)
      .offset(filtros.offset)
  }

  /**
   * UC10 — Publicação de plantão pelo gestor. Regras: RN20 (vagas >= 1),
   * RN23 (instituição administrada pelo gestor), RN25 (MSG-16), RN26
   * (nasce 'ABERTO'), MSG-14.
   */
  async criar(usuarioId: string, dados: CriarPlantao) {
    const [instituicao] = await this.db
      .select({
        id: instituicoesTable.id,
        ativa: instituicoesTable.ativa,
      })
      .from(instituicoesTable)
      .where(
        and(
          eq(instituicoesTable.id, dados.instituicao_id),
          isNull(instituicoesTable.deleted_at),
        ),
      )
      .limit(1)
    if (!instituicao) {
      throw new NotFoundException('Instituição não encontrada')
    }

    const gestor = await this.acesso.exigirVinculo(usuarioId, instituicao.id)
    if (!instituicao.ativa) {
      throw new ConflictException('Esta instituição está desativada')
    }

    // RN25 — Coerência temporal (MSG-16); a checagem no banco
    // (plantoes_periodo_check) é a última linha de defesa.
    if (dados.data_fim.getTime() <= dados.data_inicio.getTime()) {
      throw new BadRequestException(mensagensOficiais['MSG-16'])
    }

    const [criado] = await this.db
      .insert(plantoesTable)
      .values({
        instituicao_id: instituicao.id,
        gestor_criador_id: usuarioId,
        // Título é opcional no formulário; o banco exige um valor.
        titulo: dados.titulo ?? `Plantão de ${dados.especialidade}`,
        descricao: dados.descricao,
        local_unidade: dados.local_unidade,
        especialidade: dados.especialidade,
        data_inicio: dados.data_inicio,
        data_fim: dados.data_fim,
        valor: dados.valor.toFixed(2),
        quantidade_vagas: dados.quantidade_vagas,
        // RN26 — Recém-criado nasce 'ABERTO' com todas as vagas disponíveis.
        vagas_disponiveis: dados.quantidade_vagas,
        status: 'ABERTO',
      })
      .returning({
        id: plantoesTable.id,
        instituicao_id: plantoesTable.instituicao_id,
        titulo: plantoesTable.titulo,
        descricao: plantoesTable.descricao,
        local_unidade: plantoesTable.local_unidade,
        especialidade: plantoesTable.especialidade,
        data_inicio: plantoesTable.data_inicio,
        data_fim: plantoesTable.data_fim,
        valor: plantoesTable.valor,
        quantidade_vagas: plantoesTable.quantidade_vagas,
        vagas_disponiveis: plantoesTable.vagas_disponiveis,
        status: plantoesTable.status,
      })

    // Ação crítica: publicação de vaga.
    this.logger.log(
      JSON.stringify({
        evento: 'PLANTAO_CRIADO',
        plantao_id: criado.id,
        instituicao_id: criado.instituicao_id,
        gestor_id: gestor.id,
      }),
    )

    return {
      message: mensagensOficiais['MSG-14'],
      plantao: criado,
    }
  }

  /** UC10 — Plantões das instituições administradas pelo gestor logado. */
  async listarGerenciados(
    usuarioId: string,
    filtros: ListarPlantoesGerenciados,
  ) {
    const gestor = await this.perfilGestor(usuarioId)

    const condicoes = [
      eq(gestoresInstituicoesTable.gestor_id, gestor.id),
      isNull(plantoesTable.deleted_at),
      isNull(instituicoesTable.deleted_at),
    ]
    if (filtros.instituicao_id) {
      condicoes.push(eq(plantoesTable.instituicao_id, filtros.instituicao_id))
    }
    if (filtros.status) {
      condicoes.push(eq(plantoesTable.status, filtros.status))
    }

    return this.db
      .select({
        id: plantoesTable.id,
        titulo: plantoesTable.titulo,
        descricao: plantoesTable.descricao,
        local_unidade: plantoesTable.local_unidade,
        especialidade: plantoesTable.especialidade,
        data_inicio: plantoesTable.data_inicio,
        data_fim: plantoesTable.data_fim,
        valor: plantoesTable.valor,
        quantidade_vagas: plantoesTable.quantidade_vagas,
        vagas_disponiveis: plantoesTable.vagas_disponiveis,
        status: plantoesTable.status,
        permite_candidatura: plantoesTable.permite_candidatura,
        exige_checkin: plantoesTable.exige_checkin,
        permite_geolocalizacao: plantoesTable.permite_geolocalizacao,
        instituicao: {
          id: instituicoesTable.id,
          nome: instituicoesTable.nome,
          nome_fantasia: instituicoesTable.nome_fantasia,
          cidade: instituicoesTable.cidade,
          uf: instituicoesTable.uf,
        },
      })
      .from(plantoesTable)
      .innerJoin(
        instituicoesTable,
        eq(plantoesTable.instituicao_id, instituicoesTable.id),
      )
      .innerJoin(
        gestoresInstituicoesTable,
        and(
          eq(gestoresInstituicoesTable.instituicao_id, instituicoesTable.id),
          eq(gestoresInstituicoesTable.gestor_id, gestor.id),
        ),
      )
      .where(and(...condicoes))
      .orderBy(asc(plantoesTable.data_inicio), asc(plantoesTable.id))
      .limit(filtros.limit)
      .offset(filtros.offset)
  }

  /** Todas as mutações serializam na mesma linha usada pela aprovação UC11. */
  private async plantaoGerenciado(
    tx: Parameters<Parameters<Database['transaction']>[0]>[0],
    gestorId: string,
    id: string,
  ) {
    const [plantao] = await tx
      .select()
      .from(plantoesTable)
      .where(and(eq(plantoesTable.id, id), isNull(plantoesTable.deleted_at)))
      .for('update')
      .limit(1)
    if (!plantao) throw new NotFoundException('Plantão não encontrado')
    const [vinculo] = await tx
      .select({ id: instituicoesTable.id })
      .from(gestoresInstituicoesTable)
      .innerJoin(
        instituicoesTable,
        eq(instituicoesTable.id, gestoresInstituicoesTable.instituicao_id),
      )
      .where(
        and(
          eq(gestoresInstituicoesTable.gestor_id, gestorId),
          eq(instituicoesTable.id, plantao.instituicao_id),
          isNull(instituicoesTable.deleted_at),
        ),
      )
      .limit(1)
    if (!vinculo)
      throw new ForbiddenException('Você não administra este plantão')
    return plantao
  }

  async editar(usuarioId: string, id: string, dados: EditarPlantao) {
    const gestor = await this.perfilGestor(usuarioId)
    return this.db.transaction(async (tx) => {
      const atual = await this.plantaoGerenciado(tx, gestor.id, id)
      if (
        !['ABERTO', 'PREENCHIDO'].includes(atual.status) ||
        atual.data_inicio.getTime() <= Date.now()
      ) {
        throw new ConflictException(
          'Somente plantões ainda não iniciados podem ser editados',
        )
      }
      const [ativa] = await tx
        .select({ id: candidaturasTable.id })
        .from(candidaturasTable)
        .where(
          and(
            eq(candidaturasTable.plantao_id, id),
            isNull(candidaturasTable.deleted_at),
            inArray(candidaturasTable.status, ['PENDENTE', 'APROVADA']),
          ),
        )
        .limit(1)
      const mudouPeriodoOuValor =
        (dados.data_inicio !== undefined &&
          dados.data_inicio.getTime() !== atual.data_inicio.getTime()) ||
        (dados.data_fim !== undefined &&
          dados.data_fim.getTime() !== atual.data_fim.getTime()) ||
        (dados.valor !== undefined && dados.valor.toFixed(2) !== atual.valor)
      if (
        ativa &&
        (mudouPeriodoOuValor ||
          (dados.especialidade !== undefined &&
            dados.especialidade !== atual.especialidade) ||
          (dados.local_unidade !== undefined &&
            dados.local_unidade !== atual.local_unidade))
      ) {
        throw new ConflictException(
          'Com candidaturas ativas, datas, horários, valor, especialidade e local não podem ser alterados',
        )
      }
      const inicio = dados.data_inicio ?? atual.data_inicio
      const fim = dados.data_fim ?? atual.data_fim
      if (fim <= inicio)
        throw new BadRequestException(mensagensOficiais['MSG-16'])
      if (inicio.getTime() <= Date.now())
        throw new ConflictException('O início deve estar no futuro')
      const alocacoes = await tx
        .select({ id: alocacoesTable.id })
        .from(alocacoesTable)
        .where(
          and(
            eq(alocacoesTable.plantao_id, id),
            isNull(alocacoesTable.deleted_at),
          ),
        )
      // Mesmo com candidatura inconsistente, não remarca um compromisso confirmado.
      if (alocacoes.length && mudouPeriodoOuValor) {
        throw new ConflictException(
          'Plantão com alocações não permite alterar datas ou valor',
        )
      }
      const quantidade = dados.quantidade_vagas ?? atual.quantidade_vagas
      if (quantidade < alocacoes.length)
        throw new ConflictException(
          'A quantidade de vagas não pode ser menor que as alocações confirmadas',
        )
      const vagas = quantidade - alocacoes.length
      const [plantao] = await tx
        .update(plantoesTable)
        .set({
          ...dados,
          valor: dados.valor?.toFixed(2) ?? atual.valor,
          vagas_disponiveis: vagas,
          status: vagas === 0 ? 'PREENCHIDO' : 'ABERTO',
        })
        .where(eq(plantoesTable.id, id))
        .returning()
      if (vagas === 0) {
        // RN21 também vale quando a redução de capacidade esgota as vagas.
        const rejeitadas = await tx
          .update(candidaturasTable)
          .set({
            status: 'REJEITADA',
            analisado_por_gestor_id: gestor.id,
            analisado_at: new Date(),
            observacao_gestor: 'Vagas preenchidas',
          })
          .where(
            and(
              eq(candidaturasTable.plantao_id, id),
              eq(candidaturasTable.status, 'PENDENTE'),
              isNull(candidaturasTable.deleted_at),
            ),
          )
          .returning({ medico_id: candidaturasTable.medico_id })
        if (rejeitadas.length) {
          const destinos = await tx
            .select({ usuario_id: medicosTable.usuario_id })
            .from(medicosTable)
            .where(
              inArray(
                medicosTable.id,
                rejeitadas.map((c) => c.medico_id),
              ),
            )
          await tx.insert(notificacoesTable).values(
            destinos.map((d) => ({
              usuario_destino_id: d.usuario_id,
              plantao_id: id,
              tipo: 'CANDIDATURA_REJEITADA',
            })),
          )
        }
      }
      this.logger.log(
        JSON.stringify({
          evento: 'PLANTAO_EDITADO',
          plantao_id: id,
          gestor_id: gestor.id,
        }),
      )
      return { message: 'Plantão atualizado com sucesso', plantao }
    })
  }

  async encerrar(
    usuarioId: string,
    id: string,
    status: 'CANCELADO' | 'CONCLUIDO',
  ) {
    const gestor = await this.perfilGestor(usuarioId)
    return this.db.transaction(async (tx) => {
      const atual = await this.plantaoGerenciado(tx, gestor.id, id)
      if (!['ABERTO', 'PREENCHIDO'].includes(atual.status)) {
        throw new ConflictException('Este plantão já foi encerrado')
      }
      const agora = new Date()
      if (status === 'CANCELADO' && atual.data_inicio <= agora) {
        throw new ConflictException(
          'Plantões já iniciados não podem ser cancelados',
        )
      }
      if (status === 'CONCLUIDO' && atual.data_fim > agora) {
        throw new ConflictException(
          'O plantão só pode ser concluído após o término',
        )
      }
      if (status === 'CANCELADO') {
        const [pago] = await tx
          .select({ id: pagamentosTable.id })
          .from(pagamentosTable)
          .innerJoin(
            alocacoesTable,
            eq(pagamentosTable.alocacao_id, alocacoesTable.id),
          )
          .where(
            and(
              eq(alocacoesTable.plantao_id, id),
              eq(pagamentosTable.status, 'PAGO'),
            ),
          )
          .limit(1)
        const [presenca] = await tx
          .select({ id: registrosPontoTable.id })
          .from(registrosPontoTable)
          .innerJoin(
            alocacoesTable,
            eq(registrosPontoTable.alocacao_id, alocacoesTable.id),
          )
          .where(eq(alocacoesTable.plantao_id, id))
          .limit(1)
        if (pago || presenca)
          throw new ConflictException(
            'Plantão com pagamento realizado ou presença exige análise antes do cancelamento',
          )
      }
      const participantes = await tx
        .selectDistinct({ usuario_id: medicosTable.usuario_id })
        .from(candidaturasTable)
        .innerJoin(
          medicosTable,
          eq(candidaturasTable.medico_id, medicosTable.id),
        )
        .where(
          and(
            eq(candidaturasTable.plantao_id, id),
            isNull(candidaturasTable.deleted_at),
            inArray(candidaturasTable.status, ['PENDENTE', 'APROVADA']),
          ),
        )
      await tx
        .update(candidaturasTable)
        .set({
          status: 'REJEITADA',
          analisado_por_gestor_id: gestor.id,
          analisado_at: agora,
          observacao_gestor:
            status === 'CANCELADO' ? 'Plantão cancelado' : 'Plantão concluído',
        })
        .where(
          and(
            eq(candidaturasTable.plantao_id, id),
            isNull(candidaturasTable.deleted_at),
            eq(candidaturasTable.status, 'PENDENTE'),
          ),
        )
      if (status === 'CANCELADO') {
        // Preserva autor, instante e observação da aprovação original.
        await tx
          .update(candidaturasTable)
          .set({ status: 'REJEITADA' })
          .where(
            and(
              eq(candidaturasTable.plantao_id, id),
              eq(candidaturasTable.status, 'APROVADA'),
              isNull(candidaturasTable.deleted_at),
            ),
          )
        await tx
          .update(alocacoesTable)
          .set({ deleted_at: agora })
          .where(
            and(
              eq(alocacoesTable.plantao_id, id),
              isNull(alocacoesTable.deleted_at),
            ),
          )
      }
      const [plantao] = await tx
        .update(plantoesTable)
        .set({
          status,
          permite_candidatura: false,
          ...(status === 'CANCELADO'
            ? { vagas_disponiveis: atual.quantidade_vagas }
            : {}),
        })
        .where(eq(plantoesTable.id, id))
        .returning()
      if (participantes.length)
        await tx.insert(notificacoesTable).values(
          participantes.map((p) => ({
            usuario_destino_id: p.usuario_id,
            plantao_id: id,
            tipo:
              status === 'CANCELADO'
                ? 'PLANTAO_CANCELADO'
                : 'PLANTAO_CONCLUIDO',
          })),
        )
      this.logger.log(
        JSON.stringify({
          evento: `PLANTAO_${status}`,
          plantao_id: id,
          gestor_id: gestor.id,
        }),
      )
      return {
        message:
          status === 'CANCELADO'
            ? 'Plantão cancelado com sucesso'
            : 'Plantão concluído com sucesso',
        plantao,
      }
    })
  }

  /** Perfil de gestor ativo (regra centralizada em GestoresService). */
  private async perfilGestor(usuarioId: string) {
    return this.gestores.perfilAtivo(usuarioId)
  }
}
