import {
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import { and, eq, isNull } from 'drizzle-orm'
import { DRIZZLE_DB, type Database } from '../db/db.provider.ts'
import {
  gestoresInstituicoesTable,
  instituicoesTable,
  plantoesTable,
} from '../db/schemas/index.ts'
import { GestoresService } from './gestores.service.ts'

@Injectable()
export class AcessoInstitucionalService {
  constructor(
    @Inject(DRIZZLE_DB) private readonly db: Database,
    @Inject(GestoresService) private readonly gestores: GestoresService,
  ) {}

  async exigirVinculo(usuarioId: string, instituicaoId: string) {
    const gestor = await this.gestores.perfilAtivo(usuarioId)
    const [vinculo] = await this.db
      .select({ id: gestoresInstituicoesTable.gestor_id })
      .from(gestoresInstituicoesTable)
      .where(
        and(
          eq(gestoresInstituicoesTable.gestor_id, gestor.id),
          eq(gestoresInstituicoesTable.instituicao_id, instituicaoId),
        ),
      )
      .limit(1)
    if (!vinculo)
      throw new ForbiddenException('Você não administra esta instituição')
    return gestor
  }

  async exigirAcessoPlantao(usuarioId: string, plantaoId: string) {
    const [plantao] = await this.db
      .select({ instituicao_id: plantoesTable.instituicao_id })
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
      .limit(1)
    if (!plantao) throw new NotFoundException('Plantão não encontrado')
    return this.exigirVinculo(usuarioId, plantao.instituicao_id)
  }
}
