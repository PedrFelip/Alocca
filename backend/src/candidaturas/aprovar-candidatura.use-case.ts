import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common'
import { AcessoInstitucionalService } from '../gestores/acesso-institucional.service.ts'
import { DRIZZLE_DB, type Database } from '../db/db.provider.ts'
import { serializarLogCritico } from '../common/log-critico.ts'
import { mensagensOficiais } from '../common/mensagens.ts'
import { AlocacaoRepository } from './alocacao.repository.ts'

const MSG_CRM_NAO_VALIDADO_GESTOR =
  'O CRM deste médico não está validado. A candidatura não pode ser aprovada.'
const MSG_PLANTAO_ENCERRADO =
  'Este plantão já terminou e não pode receber alocação.'
const MSG_INSTITUICAO_INATIVA = 'A instituição deste plantão está inativa.'
const MSG_MEDICO_INATIVO = 'A conta deste médico não está ativa.'
const MSG_DOUBLE_BOOKING = mensagensOficiais['MSG-10']
const MSG_ALOCACAO = mensagensOficiais['MSG-17']

@Injectable()
export class AprovarCandidaturaUseCase {
  private readonly logger = new Logger(AprovarCandidaturaUseCase.name)
  constructor(
    @Inject(DRIZZLE_DB) private readonly db: Database,
    @Inject(AcessoInstitucionalService)
    private readonly acesso: AcessoInstitucionalService,
    @Inject(AlocacaoRepository) private readonly alocacoes: AlocacaoRepository,
  ) {}
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
  async executar(plantaoId: string, candidaturaId: string, usuarioId: string) {
    const gestor = await this.acesso.exigirAcessoPlantao(usuarioId, plantaoId)

    const resultado = await this.db.transaction(async (tx) => {
      // Leitura inicial sem trava: só para descobrir de quem é a candidatura.
      const [reserva] = await this.alocacoes.candidatura(tx, candidaturaId)
      if (!reserva) {
        throw new NotFoundException('Candidatura não encontrada')
      }

      // 1ª trava: médico — dois gestores aprovando o mesmo médico em plantões
      // sobrepostos disputam esta linha; o segundo reavalia a agenda após o
      // commit do primeiro (RN16 a rigor).
      const [medico] = await this.alocacoes.bloquearMedico(
        tx,
        reserva.medico_id,
      )
      if (!medico) throw new NotFoundException('Perfil médico não encontrado')
      // o crm pode ter sido rejeitado depois da candidatura
      if (medico.status_validacao !== 'APROVADO') {
        throw new ForbiddenException(MSG_CRM_NAO_VALIDADO_GESTOR)
      }

      // 2ª trava: plantão.
      const [plantao] = await this.alocacoes.bloquearPlantao(tx, plantaoId)
      if (!plantao) throw new NotFoundException('Plantão não encontrado')
      if (reserva.plantao_id !== plantaoId) {
        throw new NotFoundException('Candidatura não encontrada neste plantão')
      }
      if (plantao.status !== 'ABERTO' || plantao.vagas_disponiveis <= 0) {
        throw new ConflictException(
          'Este plantão não está aberto para alocação',
        )
      }
      const agora = new Date()
      if (plantao.data_fim <= agora) {
        throw new ConflictException(MSG_PLANTAO_ENCERRADO)
      }
      if (plantao.data_inicio <= agora) {
        throw new ConflictException(
          'Este plantão já começou e não pode receber alocação.',
        )
      }

      const [instituicao] = await this.alocacoes.instituicaoAtiva(
        tx,
        plantao.instituicao_id,
      )
      if (!instituicao) throw new ConflictException(MSG_INSTITUICAO_INATIVA)

      // conta do medico desativada ou bloqueada pelo admin nao e alocada
      const [contaMedico] = await this.alocacoes.contaMedico(tx, medico.id)
      if (contaMedico?.status !== 'ATIVO') {
        throw new ConflictException(MSG_MEDICO_INATIVO)
      }

      // 3ª trava: reconfirma estado da candidatura sob lock.
      const [candidatura] = await this.alocacoes.bloquearCandidatura(
        tx,
        candidaturaId,
      )
      if (candidatura.status !== 'PENDENTE') {
        throw new ConflictException('Esta candidatura já foi analisada')
      }

      // RN16 — Double-booking na aprovação: o médico pode ter sido alocado em
      // outro plantão sobreposto após se candidatar.
      const [conflito] = await this.alocacoes.sobrepoeAlocacao(
        plantaoId,
        medico.id,
        plantao,
        tx,
      )
      if (conflito) throw new ConflictException(MSG_DOUBLE_BOOKING)

      // 1. Alocação do médico.
      const [alocacao] = await this.alocacoes.criarAlocacao(
        tx,
        plantaoId,
        medico.id,
        candidaturaId,
      )

      // 2. Candidatura do aprovado.
      await this.alocacoes.aprovar(tx, candidaturaId, gestor.id)

      // 3. Pagamento inicial pendente.
      await this.alocacoes.criarPagamento(
        tx,
        alocacao.id,
        plantao.valor,
        gestor.id,
      )

      // 4. Decremento atômico da vaga (só se ainda houver vaga).
      const [atualizado] = await this.alocacoes.decrementarVaga(tx, plantaoId)
      if (!atualizado) {
        throw new ConflictException(
          'Não há vagas disponíveis para este plantão',
        )
      }
      const preenchido = atualizado.vagas_disponiveis === 0

      // 5. Notificações em outbox, na mesma transação (UC11; provedor: D10).
      const eventos: Array<{
        usuario_destino_id: string
        plantao_id: string
        tipo: string
      }> = []
      const medicosDestino = [alocacao.medico_id]
      if (preenchido) {
        await this.alocacoes.preencherPlantao(tx, plantaoId)
        const rejeitadas = await this.alocacoes.rejeitarRestantes(
          tx,
          plantaoId,
          candidaturaId,
          gestor.id,
        )
        medicosDestino.push(...rejeitadas.map((c) => c.medico_id))
      }
      const destinatarios = await this.alocacoes.usuariosPorMedicoId(
        tx,
        medicosDestino,
      )
      if (preenchido) {
        eventos.push(
          ...destinatarios
            .filter((d) => d.medico_id !== alocacao.medico_id)
            .map((destino) => ({
              usuario_destino_id: destino.usuario_id,
              plantao_id: plantaoId,
              tipo: 'CANDIDATURA_REJEITADA',
            })),
        )
      }
      const aprovado = destinatarios.find(
        (d) => d.medico_id === alocacao.medico_id,
      )
      if (aprovado) {
        eventos.push({
          usuario_destino_id: aprovado.usuario_id,
          plantao_id: plantaoId,
          tipo: 'ALOCACAO_APROVADA',
        })
      }
      const outbox = await this.alocacoes.notificar(tx, eventos)

      const statusPlantaoFinal = preenchido
        ? ('PREENCHIDO' as const)
        : atualizado.status

      return {
        audit: {
          plantao_preenchido: preenchido,
          notificacoes: eventos.map((e) => ({
            usuario_destino_id: e.usuario_destino_id,
            tipo: e.tipo,
          })),
          outbox_ids: outbox.map((n) => n.id),
        },
        message: MSG_ALOCACAO,
        alocacao: {
          id: alocacao.id,
          plantao_id: alocacao.plantao_id,
          medico_id: alocacao.medico_id,
          candidatura_id: alocacao.candidatura_id,
        },
        plantao: {
          id: plantaoId,
          status: statusPlantaoFinal,
          quantidade_vagas: atualizado.quantidade_vagas,
          vagas_disponiveis: atualizado.vagas_disponiveis,
        },
      }
    })
    this.logger.log(
      serializarLogCritico({
        evento: 'ALOCACAO_APROVADA',
        plantao_id: plantaoId,
        candidatura_id: candidaturaId,
        alocacao_id: resultado.alocacao.id,
        medico_id: resultado.alocacao.medico_id,
        gestor_id: gestor.id,
        plantao_status: resultado.plantao.status,
        ...resultado.audit,
      }),
    )
    const { audit: _audit, ...resposta } = resultado
    return resposta
  }
}
