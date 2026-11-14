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
  candidaturasTable,
  gestoresInstituicoesTable,
  instituicoesTable,
  medicosTable,
  plantoesTable,
} from '../db/schemas/index.ts'
import type {
  CriarPlantao,
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
  ) {}

  async listar(usuarioId: string, filtros: ListarPlantoes) {
    const [medico] = await this.db
      .select({ id: medicosTable.id })
      .from(medicosTable)
      .where(
        and(
          eq(medicosTable.usuario_id, usuarioId),
          isNull(medicosTable.deleted_at),
        ),
      )
      .limit(1)
    if (!medico) throw new NotFoundException('Perfil médico não encontrado')

    const condicoes = [
      eq(plantoesTable.status, 'ABERTO'),
      eq(plantoesTable.permite_candidatura, true),
      eq(instituicoesTable.ativa, true),
      gt(plantoesTable.vagas_disponiveis, 0),
      gte(plantoesTable.data_fim, sql`now()`),
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
              eq(candidaturasTable.medico_id, medico.id),
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
    const gestor = await this.perfilGestor(usuarioId)

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

    // RN23 — Só publica em instituição ativa vinculada ao gestor.
    const [vinculo] = await this.db
      .select({ um: sql`1` })
      .from(gestoresInstituicoesTable)
      .where(
        and(
          eq(gestoresInstituicoesTable.gestor_id, gestor.id),
          eq(gestoresInstituicoesTable.instituicao_id, instituicao.id),
        ),
      )
      .limit(1)
    if (!vinculo) {
      throw new ForbiddenException('Você não administra esta instituição')
    }
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
  async listarGerenciados(usuarioId: string, filtros: ListarPlantoesGerenciados) {
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

  /** Perfil de gestor ativo (regra centralizada em GestoresService). */
  private async perfilGestor(usuarioId: string) {
    return this.gestores.perfilAtivo(usuarioId)
  }
}
