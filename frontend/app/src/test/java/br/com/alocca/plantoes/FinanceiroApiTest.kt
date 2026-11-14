package br.com.alocca.plantoes

import com.sun.net.httpserver.HttpServer
import java.net.InetSocketAddress
import java.math.BigDecimal
import org.junit.Assert.*
import org.junit.Test

class FinanceiroApiTest {
    private fun servidor(status: Int, mime: String = "application/json", body: ByteArray, teste: (FinanceiroCliente, MutableList<Pair<String, ByteArray>>) -> Unit) {
        val chamadas = mutableListOf<Pair<String, ByteArray>>()
        val server = HttpServer.create(InetSocketAddress("127.0.0.1", 0), 0)
        server.createContext("/") { exchange ->
            chamadas += "${exchange.requestMethod} ${exchange.requestURI} ${exchange.requestHeaders.getFirst("Authorization")} ${exchange.requestHeaders.getFirst("Content-Type")}" to exchange.requestBody.readBytes()
            exchange.responseHeaders.set("Content-Type", mime)
            exchange.sendResponseHeaders(status, body.size.toLong())
            exchange.responseBody.use { it.write(body) }
        }
        server.start()
        try { teste(FinanceiroCliente("http://127.0.0.1:${server.address.port}/"), chamadas) }
        finally { server.stop(0) }
    }

    @Test fun `lista autenticada preserva decimal e dados reais`() {
        val json = """[{"id":"p1","medico":{"nome":"Ana"},"plantao":{"titulo":"UTI"},"instituicao":{"nome":"Hospital"},"valor":"1234.56"}]"""
        servidor(200, body = json.toByteArray()) { api, chamadas ->
            val p = (api.pendentes("token") as Resposta.Ok).dados.single()
            assertEquals(BigDecimal("1234.56"), p.valor)
            assertEquals("Ana", p.medico)
            assertTrue(chamadas.single().first.startsWith("GET /financeiro/pendentes-baixa Bearer token"))
        }
    }

    @Test fun `upload multipart envia bearer arquivo e campo correto`() {
        servidor(200, body = """{"message":"Pago"}""".toByteArray()) { api, chamadas ->
            val bytes = byteArrayOf(0, 1, 2, -1)
            assertEquals(Resposta.Ok("Pago"), api.darBaixa("token", "p1", ComprovanteArquivo("comprovante.pdf", "application/pdf", bytes)))
            val (header, body) = chamadas.single()
            assertTrue(header.startsWith("POST /financeiro/pagamentos/p1/dar-baixa Bearer token multipart/form-data; boundary="))
            val texto = body.toString(Charsets.ISO_8859_1)
            assertTrue(texto.contains("name=\"comprovante\"; filename=\"comprovante.pdf\""))
            assertTrue(texto.contains("Content-Type: application/pdf\r\n\r\n"))
            assertTrue(texto.contains(bytes.toString(Charsets.ISO_8859_1)))
        }
    }

    @Test fun `download binario autenticado preserva conteudo e extensao`() {
        val bytes = "%PDF-1.4\n%%EOF".toByteArray()
        servidor(200, "application/pdf", bytes) { api, chamadas ->
            val r = (api.baixar("token", "p1") as Resposta.Ok).dados
            assertArrayEquals(bytes, r.bytes)
            assertEquals("comprovante-p1.pdf", r.nome)
            assertTrue(chamadas.single().first.startsWith("GET /financeiro/comprovantes/p1 Bearer token"))
        }
    }

    @Test fun `sessao expirada e arquivo ausente nunca retornam sucesso`() {
        for (status in listOf(401, 404, 503)) servidor(status, body = """{"message":"Indisponível"}""".toByteArray()) { api, _ ->
            val r = api.baixar("token", "p1") as Resposta.Falha
            assertEquals(status, r.status)
            assertEquals(status == 401, r.sessaoExpirada)
        }
    }

    @Test fun `download rejeita MIME inesperado e arquivo acima do limite`() {
        servidor(200, "text/html", "erro".toByteArray()) { api, _ -> assertTrue(api.baixar("t", "p") is Resposta.Falha) }
        servidor(200, "application/pdf", ByteArray(FinanceiroCliente.LIMITE + 1)) { api, _ -> assertTrue(api.baixar("t", "p") is Resposta.Falha) }
    }

    @Test fun `lista com JSON invalido e baixa rejeitada retornam falha`() {
        servidor(200, body = "{}".toByteArray()) { api, _ -> assertTrue(api.pendentes("t") is Resposta.Falha) }
        servidor(409, body = """{"message":"Já baixado"}""".toByteArray()) { api, _ ->
            val r = api.darBaixa("t", "p", ComprovanteArquivo("a.pdf", "application/pdf", byteArrayOf(1))) as Resposta.Falha
            assertEquals(409, r.status)
            assertEquals("Já baixado", r.mensagem)
        }
    }
}
