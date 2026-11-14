package br.com.alocca.plantoes

import com.sun.net.httpserver.HttpServer
import java.net.InetSocketAddress
import org.junit.Assert.*
import org.junit.Test

class NotificacoesApiTest {
    private fun servidor(status: Int, body: ByteArray = ByteArray(0), teste: (NotificacoesCliente, MutableList<String>) -> Unit) {
        val chamadas = mutableListOf<String>()
        val server = HttpServer.create(InetSocketAddress("127.0.0.1", 0), 0)
        server.createContext("/") { exchange ->
            chamadas += "${exchange.requestMethod} ${exchange.requestURI} ${exchange.requestHeaders.getFirst("Authorization")}"
            val corpo = exchange.requestBody.readBytes()
            if (corpo.isNotEmpty()) chamadas += corpo.toString(Charsets.UTF_8)
            // Corpo vazio = resposta sem conteúdo (PATCH/PUT/DELETE do contrato).
            exchange.sendResponseHeaders(status, if (body.isEmpty()) -1 else body.size.toLong())
            exchange.responseBody.use { if (body.isNotEmpty()) it.write(body) }
        }
        server.start()
        try { teste(NotificacoesCliente("http://127.0.0.1:${server.address.port}/"), chamadas) }
        finally { server.stop(0) }
    }

    private fun paginaJson(itens: String = "", cursor: String? = null, naoLidas: Int? = null): String {
        val partes = mutableListOf(""" "items":[$itens] """)
        if (cursor != null) partes += """"next_cursor":"$cursor""""
        if (naoLidas != null) partes += """"nao_lidas":$naoLidas"""
        return "{${partes.joinToString(",")}}"
    }

    private val CURSOR = "5f0c40ba-0a11-4c0e-8c1f-000000000001"

    @Test fun `pagina do inbox preserva dados e contagem do servidor`() {
        val json = paginaJson(
            itens = """{"id":"n1","tipo":"ALOCACAO_APROVADA","plantao_id":"p1","created_at":"2026-11-14T15:47:00Z","lida_at":null},
                       {"id":"n2","tipo":"CHECKIN","plantao_id":null,"created_at":"2026-11-13T10:00:00Z","lida_at":"2026-11-13T11:00:00Z"}""",
            cursor = CURSOR, naoLidas = 1,
        )
        servidor(200, json.toByteArray()) { api, chamadas ->
            val pagina = (api.listar("token") as Resposta.Ok).dados
            assertEquals(2, pagina.itens.size)
            assertEquals("ALOCACAO_APROVADA", pagina.itens[0].tipo)
            assertEquals("p1", pagina.itens[0].plantaoId)
            assertTrue(pagina.itens[0].naoLida)
            assertFalse(pagina.itens[1].naoLida)
            assertEquals(CURSOR, pagina.nextCursor)
            assertEquals(1, pagina.naoLidas)
            assertTrue(chamadas.single().startsWith("GET /notificacoes?limite=20 Bearer token"))
        }
    }

    @Test fun `pagina sem nao_lidas deixa o cliente contar e cursor invalido vira fim`() {
        val json = paginaJson(
            itens = """{"id":"n1","tipo":"X","created_at":"2026-11-14T15:47:00Z"}""",
            cursor = "nao-e-uuid",
        )
        servidor(200, json.toByteArray()) { api, _ ->
            val pagina = (api.listar("token") as Resposta.Ok).dados
            assertNull(pagina.naoLidas)
            assertNull(pagina.nextCursor)
            assertEquals(contarNaoLidas(pagina.itens), 1)
        }
    }

    @Test fun `item sem id e descartado sem quebrar a pagina`() {
        val json = paginaJson(itens = """{"tipo":"X"},{"id":"n1","tipo":"Y","created_at":"z"}""")
        servidor(200, json.toByteArray()) { api, _ ->
            val pagina = (api.listar("token") as Resposta.Ok).dados
            assertEquals(listOf("n1"), pagina.itens.map { it.id })
        }
    }

    @Test fun `cursor uuid entra na url e cursor estranho nao`() {
        val uuid = "123e4567-e89b-12d3-a456-426614174000"
        servidor(200) { api, chamadas ->
            api.listar("token", uuid)
            api.listar("token", "../admin")
            assertEquals(
                listOf(
                    "GET /notificacoes?limite=20&cursor=$uuid",
                    "GET /notificacoes?limite=20",
                ),
                chamadas.map { it.substringBefore(" Bearer") },
            )
        }
    }

    // PATCH é validado no teste instrumentado Android; HttpURLConnection do
    // JDK de desktop rejeita esse método, ao contrário do transporte Android.

    @Test fun `preferencias le e salva por canal`() {
        servidor(200, """{"push":true,"email":false}""".toByteArray()) { api, chamadas ->
            val pref = (api.preferencias("token") as Resposta.Ok).dados
            assertEquals(PreferenciasNotificacao(push = true, email = false), pref)
            assertTrue(chamadas.single().startsWith("GET /notificacoes/preferencias Bearer token"))
        }
        servidor(200) { api, chamadas ->
            assertEquals(Resposta.Ok(Unit), api.salvarPreferencias("token", PreferenciasNotificacao(push = false, email = true)))
            assertTrue(chamadas[0].startsWith("PUT /notificacoes/preferencias Bearer token"))
            assertEquals("""{"push":false,"email":true}""", chamadas[1])
        }
    }

    @Test fun `worker consulta nao lidas com limite maior sem alterar leitura`() {
        servidor(200, """{"items":[],"next_cursor":null,"nao_lidas":0}""".toByteArray()) { api, chamadas ->
            assertTrue(api.listar("token", somenteNaoLidas = true, limite = 100) is Resposta.Ok)
            assertTrue(chamadas.single().startsWith("GET /notificacoes?limite=100&somente_nao_lidas=true Bearer token"))
        }
    }

    @Test fun `sessao expirada servidor invalido e conexao falha nunca sao sucesso`() {
        for (status in listOf(401, 500)) servidor(status, """{"message":"Falha"}""".toByteArray()) { api, _ ->
            val r = api.listar("token") as Resposta.Falha
            assertEquals(status, r.status)
            assertFalse(r.mensagem.isBlank())
        }
        assertTrue(apiForaDoAr() is Resposta.Falha)
    }

    private fun apiForaDoAr(): Resposta<PaginaNotificacoes> =
        NotificacoesCliente("http://127.0.0.1:1/").listar("token")

    @Test fun `parse de preferencias tolera chaves ausentes`() {
        assertEquals(PreferenciasNotificacao(false, false), parsePreferencias("{}"))
        assertEquals(PreferenciasNotificacao(true, true), parsePreferencias("""{"push":true,"email":true}"""))
    }
}
