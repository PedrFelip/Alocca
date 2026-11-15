import {
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common'
import { sql } from 'drizzle-orm'
import { DRIZZLE_DB, type Database } from '../db/db.provider.ts'
import { FinanceiroRepository } from './financeiro.repository.ts'
import { randomUUID } from 'node:crypto'
import { GestoresService } from '../gestores/gestores.service.ts'
import { ComprovantesStorage } from './comprovantes.storage.ts'
import { validarComprovante, type ArquivoComprovante } from './comprovante.ts'
import { mensagensOficiais } from '../common/mensagens.ts'
import type { DashboardFinanceiro } from './financeiro.tipos.ts'

@Injectable()
export class FinanceiroService {
  private readonly logger = new Logger(FinanceiroService.name)
  constructor(
    @Inject(DRIZZLE_DB) private readonly db: Database,
    @Inject(GestoresService) private readonly gestores: GestoresService,
    @Inject(ComprovantesStorage) private readonly storage: ComprovantesStorage,
    @Inject(FinanceiroRepository)
    private readonly repository: FinanceiroRepository,
  ) {}

  async pagamentosGestor(usuarioId: string) {
    const gestor = await this.gestores.perfilAtivo(usuarioId)
    return this.repository.pagamentosGestor(gestor.id)
  }

  async definirVencimento(
    usuarioId: string,
    id: string,
    vencimento: string | null,
  ) {
    const gestor = await this.gestores.perfilAtivo(usuarioId)
    try {
      await this.db.transaction(async (tx) => {
        // A baixa mantém o lock do pagamento durante o upload; um vencimento
        // concorrente espera no máximo 5s em vez de travar até o timeout do app.
        await tx.execute(sql`set local lock_timeout = '5s'`)
        const pagamento = await this.repository.bloquearPagamento(
          tx,
          gestor.id,
          id,
        )
        if (!pagamento) throw new NotFoundException('Pagamento não encontrado')
        if (pagamento.status !== 'PENDENTE')
          throw new ConflictException(mensagensOficiais['MSG-19'])
        await this.repository.definirVencimento(
          tx,
          id,
          vencimento ? new Date(vencimento) : null,
        )
      })
    } catch (erro) {
      if ((erro as { code?: string }).code === '55P03')
        throw new ServiceUnavailableException('Serviço ocupado. Tente novamente.')
      throw erro
    }
    this.logger.log(
      JSON.stringify({
        evento: 'VENCIMENTO_DEFINIDO',
        pagamento_id: id,
        gestor_id: gestor.id,
        vencimento_em: vencimento,
      }),
    )
    return { message: mensagensOficiais['MSG-20'] }
  }

  async pendentesBaixa(usuarioId: string) {
    const gestor = await this.gestores.perfilAtivo(usuarioId)
    return this.repository.pendentes(gestor.id)
  }

  async darBaixa(usuarioId: string, id: string, arquivo?: ArquivoComprovante) {
    const gestor = await this.gestores.perfilAtivo(usuarioId)
    const formato = validarComprovante(arquivo)
    const chave = `${randomUUID()}.${formato.extensao}`
    let uploadTentado = false
    let uploadConfirmado = false
    try {
      await this.db.transaction(async (tx) => {
        // Bloqueia antes do upload: a segunda requisição lê PAGO após o commit.
        const pagamento = await this.repository.bloquearPagamento(
          tx,
          gestor.id,
          id,
        )
        if (!pagamento) throw new NotFoundException('Pagamento não encontrado')
        if (pagamento.status !== 'PENDENTE' || !pagamento.elegivel)
          throw new ConflictException(
            'Pagamento já baixado ou plantão ainda não encerrado',
          )
        uploadTentado = true
        await this.storage.salvar(chave, arquivo!.buffer, formato.mime)
        uploadConfirmado = true
        // Revalida sob os mesmos locks antes da alteração financeira.
        const atual = await this.repository.revalidarPagamento(
          tx,
          gestor.id,
          id,
        )
        if (!atual || atual.status !== 'PENDENTE' || !atual.elegivel) {
          throw new ConflictException(
            'Pagamento deixou de ser elegível para baixa',
          )
        }
        await this.repository.registrarBaixa(
          tx,
          id,
          gestor.id,
          chave,
          formato.mime,
        )
      })
    } catch (erro) {
      if (uploadTentado) {
        // Timeout pode deixar PUT em andamento. Não dispute com ele usando DELETE.
        if (!uploadConfirmado) {
          this.logger.error(
            JSON.stringify({
              evento: 'COMPROVANTE_RECONCILIAR',
              chave,
              pagamento_id: id,
            }),
          )
        } else
          try {
            await this.db.transaction(async (tx) => {
              // Espera a resolução do commit original antes de inspecionar a referência.
              const pagamento = await this.repository.referenciaBloqueada(
                tx,
                id,
              )
              if (!pagamento) throw new Error('Resultado desconhecido')
              if (pagamento.chave !== chave) await this.storage.remover(chave)
            })
          } catch {
            this.logger.error(
              JSON.stringify({
                evento: 'COMPROVANTE_RECONCILIAR',
                chave,
                pagamento_id: id,
              }),
            )
          }
      }
      throw erro
    }
    this.logger.log(
      JSON.stringify({
        evento: 'PAGAMENTO_BAIXADO',
        pagamento_id: id,
        gestor_id: gestor.id,
      }),
    )
    return { message: mensagensOficiais['MSG-18'] }
  }

  async comprovante(usuarioId: string, id: string, gestor = false) {
    const pagamento = gestor
      ? await this.repository.comprovanteGestor(
          (await this.gestores.perfilAtivo(usuarioId)).id,
          id,
        )
      : await this.repository.comprovante(usuarioId, id)
    if (
      !pagamento?.chave ||
      !pagamento.mime ||
      !['application/pdf', 'image/jpeg', 'image/png'].includes(pagamento.mime)
    )
      throw new NotFoundException('Comprovante não encontrado')
    return {
      buffer: await this.storage.baixar(pagamento.chave),
      mime: pagamento.mime,
      nome: pagamento.chave,
    }
  }

  doMedico(usuarioId: string): Promise<DashboardFinanceiro> {
    return this.repository.doMedico(usuarioId)
  }
}
