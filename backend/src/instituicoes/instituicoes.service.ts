import { Inject, Injectable } from '@nestjs/common'
import { z } from 'zod'
import { CacheService } from '../cache/cache.service.ts'
import { GestoresService } from '../gestores/gestores.service.ts'
import { InstituicoesRepository } from './instituicoes.repository.ts'
import { detalhesSchema } from './instituicoes.schemas.ts'

@Injectable()
export class InstituicoesService {
  constructor(
    @Inject(InstituicoesRepository)
    private readonly repository: InstituicoesRepository,
    @Inject(GestoresService) private readonly gestores: GestoresService,
    @Inject(CacheService) private readonly cache: CacheService,
  ) {}

  /** UC10 — Lista as instituições administradas pelo gestor autenticado. */
  async vinculadas(usuarioId: string) {
    const gestor = await this.gestores.perfilAtivo(usuarioId)
    // Revisão e vínculos vêm do banco em cada leitura; TTL limita só retenção.
    const revisao = await this.repository.revisao(gestor.id)
    if (!revisao) return []
    const schema = z.object({
      revisao: z.literal(revisao),
      dados: z.array(detalhesSchema),
    })
    const snapshot = await this.cache.getOrLoad(
      `instituicoes:vinculadas:${gestor.id}:${revisao}`,
      this.cache.defaultTtlSeconds,
      () => this.repository.snapshot(gestor.id),
      (value) => schema.parse(value),
    )
    return snapshot.dados
  }
}
