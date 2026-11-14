package br.com.alocca.plantoes

import java.io.File
import java.io.OutputStream

/** Nenhum comprovante novo é gravado no cache: apenas no destino escolhido. */
internal object ComprovanteDownload {
    fun salvar(
        preparado: ComprovanteArquivo?,
        obter: () -> Resposta<ComprovanteArquivo>,
        abrirDestino: () -> OutputStream?,
    ): Resposta<Unit> {
        val arquivo = preparado ?: when (val r = obter()) {
            is Resposta.Ok -> r.dados
            is Resposta.Falha -> return r
        }
        return try {
            val destino = abrirDestino() ?: error("Destino indisponível")
            destino.use { it.write(arquivo.bytes) }
            Resposta.Ok(Unit)
        } catch (_: Exception) {
            Resposta.Falha("Não foi possível salvar. Tente novamente.", 0)
        }
    }

    /** O fluxo atual não usa mais esse diretório, inclusive após recriação. */
    fun limparCacheLegado(cacheDir: File) {
        File(cacheDir, "comprovantes").deleteRecursively()
    }
}
