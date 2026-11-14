package br.com.alocca.plantoes

import java.io.ByteArrayOutputStream
import java.io.IOException
import java.io.OutputStream
import java.nio.file.Files
import org.junit.Assert.*
import org.junit.Test

class ComprovanteDownloadTest {
    private val arquivo = ComprovanteArquivo("comprovante.pdf", "application/pdf", "%PDF-1.4\n%%EOF".toByteArray())

    @Test fun `salva bytes preparados diretamente sem repetir download`() {
        val destino = ByteArrayOutputStream()
        val resultado = ComprovanteDownload.salvar(arquivo, obter = { error("Não deve baixar novamente") }, abrirDestino = { destino })
        assertEquals(Resposta.Ok(Unit), resultado)
        assertArrayEquals(arquivo.bytes, destino.toByteArray())
    }

    @Test fun `apos morte do processo busca autenticada recupera os bytes sem cache`() {
        var buscas = 0
        val destino = ByteArrayOutputStream()
        val resultado = ComprovanteDownload.salvar(null, obter = { buscas++; Resposta.Ok(arquivo) }, abrirDestino = { destino })
        assertEquals(1, buscas)
        assertEquals(Resposta.Ok(Unit), resultado)
        assertArrayEquals(arquivo.bytes, destino.toByteArray())
    }

    @Test fun `sessao revogada na recuperacao nao abre nem grava destino`() {
        val resultado = ComprovanteDownload.salvar(null, obter = { Resposta.Falha("Sessão expirada", 401) }, abrirDestino = { error("Não deve abrir destino") })
        assertTrue((resultado as Resposta.Falha).sessaoExpirada)
    }

    @Test fun `falha na escrita fecha o destino e nunca anuncia sucesso`() {
        var fechado = false
        val destino = object : OutputStream() {
            override fun write(b: Int) { throw IOException("Disco cheio") }
            override fun close() { fechado = true }
        }
        assertTrue(ComprovanteDownload.salvar(arquivo, obter = { error("Não deve baixar") }, abrirDestino = { destino }) is Resposta.Falha)
        assertTrue(fechado)
    }

    @Test fun `destino indisponivel retorna falha`() {
        assertTrue(ComprovanteDownload.salvar(arquivo, obter = { error("Não deve baixar") }, abrirDestino = { null }) is Resposta.Falha)
    }

    @Test fun `limpeza na inicializacao e retomada elimina cache legado sem afetar outros arquivos`() {
        val cache = Files.createTempDirectory("alocca-cache-test").toFile()
        try {
            val outro = java.io.File(cache, "outra-feature").apply { writeText("preservar") }
            val legados = java.io.File(cache, "comprovantes").apply { mkdirs() }
            java.io.File(legados, "parcial.pdf").writeBytes(byteArrayOf(1, 2))
            java.io.File(legados, "antigo.pdf").writeBytes(arquivo.bytes)
            ComprovanteDownload.limparCacheLegado(cache)
            assertFalse(legados.exists())
            assertEquals("preservar", outro.readText())
            ComprovanteDownload.limparCacheLegado(cache)
            assertTrue(outro.exists())
        } finally { cache.deleteRecursively() }
    }
}
