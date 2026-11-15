import { Inject, Injectable } from '@nestjs/common'
import { ConsultasGestorRepository } from './consultas-gestor.repository.ts'
import { GestoresService } from './gestores.service.ts'
import type {
  ConsultaMedicos,
  ConsultaPonto,
} from './consultas-gestor.schemas.ts'

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

  async medicos(usuarioId: string, pagina: ConsultaMedicos) {
    const gestor = await this.gestores.perfilAtivo(usuarioId)
    return this.repository.medicos(gestor.id, pagina)
  }

  async ponto(usuarioId: string, pagina: ConsultaPonto) {
    const gestor = await this.gestores.perfilAtivo(usuarioId)
    return this.repository.ponto(gestor.id, pagina)
  }
}
