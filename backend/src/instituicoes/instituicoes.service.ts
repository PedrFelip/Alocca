import { Inject, Injectable } from '@nestjs/common'
import { and, asc, eq, isNull } from 'drizzle-orm'
import { GestoresService } from '../gestores/gestores.service.ts'
import { DRIZZLE_DB, type Database } from '../db/db.provider.ts'
import {
  gestoresInstituicoesTable,
  instituicoesTable,
} from '../db/schemas/index.ts'

@Injectable()
export class InstituicoesService {
  constructor(
    @Inject(DRIZZLE_DB) private readonly db: Database,
    @Inject(GestoresService) private readonly gestores: GestoresService,
  ) {}

  /** UC10 — Lista as instituições administradas pelo gestor autenticado. */
  async vinculadas(usuarioId: string) {
    const gestor = await this.gestores.perfilAtivo(usuarioId)

    return this.db
      .select({
        id: instituicoesTable.id,
        nome: instituicoesTable.nome,
        nome_fantasia: instituicoesTable.nome_fantasia,
        cnpj: instituicoesTable.cnpj,
        cidade: instituicoesTable.cidade,
        uf: instituicoesTable.uf,
        bairro: instituicoesTable.bairro,
        logradouro: instituicoesTable.logradouro,
      })
      .from(gestoresInstituicoesTable)
      .innerJoin(
        instituicoesTable,
        eq(gestoresInstituicoesTable.instituicao_id, instituicoesTable.id),
      )
      .where(
        and(
          eq(gestoresInstituicoesTable.gestor_id, gestor.id),
          eq(instituicoesTable.ativa, true),
          isNull(instituicoesTable.deleted_at),
        ),
      )
      .orderBy(asc(instituicoesTable.nome), asc(instituicoesTable.id))
  }
}
