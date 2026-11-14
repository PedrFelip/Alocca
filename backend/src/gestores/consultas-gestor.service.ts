import { Inject, Injectable } from '@nestjs/common'
import { ConsultasGestorRepository } from './consultas-gestor.repository.ts'
import { GestoresService } from './gestores.service.ts'
import type { HistoricoPresenca } from '../presenca/presenca.schemas.ts'

@Injectable()
export class ConsultasGestorService {
  constructor(
    @Inject(GestoresService) private readonly gestores: GestoresService,
    @Inject(ConsultasGestorRepository)
    private readonly repository: ConsultasGestorRepository,
  ) {}

  async indicadores(usuarioId: string) {
    const gestor = await this.gestores.perfilAtivo(usuarioId)
    return this.repository.indicadores(gestor.id)
  }

  async medicos(usuarioId: string, pagina: HistoricoPresenca) {
    const gestor = await this.gestores.perfilAtivo(usuarioId)
    return this.repository.medicos(gestor.id, pagina.limit, pagina.offset)
  }

  async ponto(usuarioId: string, pagina: HistoricoPresenca) {
    const gestor = await this.gestores.perfilAtivo(usuarioId)
    return this.repository.ponto(gestor.id, pagina.limit, pagina.offset)
  }
}
