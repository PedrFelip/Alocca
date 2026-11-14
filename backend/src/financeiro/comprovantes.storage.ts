import {
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common'
import { ConfigService } from '@nestjs/config'

export const MAX_COMPROVANTE = 5 * 1024 * 1024

/** Filer privado: nunca devolve endereço do storage ao cliente. */
@Injectable()
export class ComprovantesStorage {
  constructor(@Inject(ConfigService) private readonly config: ConfigService) {}

  private url(chave: string) {
    if (!/^[0-9a-f-]{36}\.(pdf|jpg|png)$/.test(chave))
      throw new NotFoundException('Comprovante não encontrado')
    return `${this.config.get<string>('SEAWEEDFS_FILER_URL', 'http://127.0.0.1:8888').replace(/\/$/, '')}/comprovantes/${chave}`
  }

  async salvar(chave: string, buffer: Buffer, mime: string) {
    try {
      const resposta = await fetch(this.url(chave), {
        method: 'PUT',
        body: new Uint8Array(buffer),
        headers: { 'Content-Type': mime },
        signal: AbortSignal.timeout(15_000),
        redirect: 'error',
      })
      if (!resposta.ok) throw new Error('upload')
      await resposta.body?.cancel()
    } catch {
      throw new ServiceUnavailableException(
        'Não foi possível armazenar o comprovante',
      )
    }
  }

  async remover(chave: string) {
    const resposta = await fetch(this.url(chave), {
      method: 'DELETE',
      signal: AbortSignal.timeout(15_000),
      redirect: 'error',
    })
    await resposta.body?.cancel()
    if (!resposta.ok && resposta.status !== 404)
      throw new Error('Falha ao remover comprovante')
  }

  async baixar(chave: string): Promise<Buffer> {
    try {
      const resposta = await fetch(this.url(chave), {
        signal: AbortSignal.timeout(15_000),
        redirect: 'error',
      })
      if (!resposta.ok) {
        await resposta.body?.cancel()
        if (resposta.status === 404)
          throw new NotFoundException('Comprovante não encontrado')
        throw new Error('download')
      }
      if (!resposta.body) throw new Error('download')
      const partes: Uint8Array[] = []
      let tamanho = 0
      for await (const parte of resposta.body) {
        tamanho += parte.length
        if (tamanho > MAX_COMPROVANTE) throw new Error('size')
        partes.push(parte)
      }
      return Buffer.concat(partes)
    } catch (erro) {
      if (erro instanceof NotFoundException) throw erro
      throw new ServiceUnavailableException(
        'Não foi possível obter o comprovante',
      )
    }
  }
}
