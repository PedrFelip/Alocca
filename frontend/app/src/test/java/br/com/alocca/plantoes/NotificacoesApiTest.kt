package br.com.alocca.plantoes

import org.junit.Assert.*
import org.junit.Test

class NotificacoesApiTest {
    @Test fun `aceitar convite envia candidatura com token e corpo vazio`() {
        val api = NotificacoesApi { path, method, body, token ->
            assertEquals("plantoes/p1/candidaturas", path)
            assertEquals("POST", method)
            assertEquals("sessao", token)
            assertEquals(0, body!!.length())
            ApiHttp.Resposta(201, """{"message":"Candidatura enviada"}""")
        }
        assertEquals("Candidatura enviada", api.aceitarConvite("sessao", "p1"))
    }

    @Test fun `convite com candidatura existente preserva status ao recarregar`() {
        val convite = item.replace("AVISO", "CONVITE_PLANTAO").dropLast(1) + ",\"candidatura_status\":\"PENDENTE\"}"
        val api = NotificacoesApi { _, _, _, _ ->
            ApiHttp.Resposta(200, """{"dados":[$convite],"pagina":1,"limite":20,"total":1}""")
        }
        assertEquals("PENDENTE", api.listar("sessao", 1).dados.single().candidaturaStatus)
    }

    @Test fun `aceitar convite preserva erros de elegibilidade e sessao`() {
        for (status in listOf(401, 403, 409)) {
            val api = NotificacoesApi { _, _, _, _ -> ApiHttp.Resposta(status, """{"message":"Não disponível"}""") }
            try {
                api.aceitarConvite("sessao", "p1")
                fail("Esperava erro")
            } catch (e: ApiException) {
                assertEquals(status, e.status)
                assertEquals("Não disponível", e.userMessage)
            }
        }
    }
    private val item = """{"id":"n1","tipo":"AVISO","plantao_id":"p1","titulo":"Título","mensagem":"Mensagem","lida_em":null,"created_at":"2026-11-14T20:00:00Z"}"""
    @Test fun `lista usa pagina token e interpreta leitura nula`() {
        val api = NotificacoesApi { path, method, body, token ->
            assertEquals("notificacoes?pagina=2&limite=20", path); assertEquals("GET", method); assertNull(body); assertEquals("token", token)
            ApiHttp.Resposta(200, """{"dados":[$item],"pagina":2,"limite":20,"total":21}""")
        }
        val pagina = api.listar("token", 2)
        assertEquals(21, pagina.total); assertEquals("p1", pagina.dados.single().plantaoId); assertNull(pagina.dados.single().lidaEm)
    }
    @Test fun `marca leitura e salva preferencia com contrato`() {
        var chamada = 0
        val api = NotificacoesApi { path, method, body, token ->
            assertEquals("sessao", token)
            if (chamada++ == 0) { assertEquals("notificacoes/n1/lida", path); assertEquals("PATCH", method); assertNull(body); ApiHttp.Resposta(200, item.replace("\"lida_em\":null", "\"lida_em\":\"2026-11-14T21:00:00Z\"")) }
            else { assertEquals("notificacoes/preferencias", path); assertEquals("PUT", method); assertTrue(body!!.getBoolean("email_habilitado")); ApiHttp.Resposta(200, """{"email_habilitado":true}""") }
        }
        assertNotNull(api.ler("sessao", "n1").lidaEm); assertTrue(api.salvar("sessao", true))
    }
    @Test fun `erros http conexao e resposta invalida preservam status`() {
        for ((response, status) in listOf(ApiHttp.Resposta(401, "{}") to 401, ApiHttp.Resposta(0, "") to 0, ApiHttp.Resposta(200, "{}") to 200)) {
            val api = NotificacoesApi { _, _, _, _ -> response }
            try { api.preferencias("t"); fail("Esperava erro") } catch (e: ApiException) { assertEquals(status, e.status) }
        }
    }
    @Test fun `paginacao preserva instante e aceita pagina vazia`() {
        val instante = "2026-11-14T20:00:00.000Z"
        val api = NotificacoesApi { path, _, _, _ ->
            assertTrue(path.contains("ate=2026-11-14T20%3A00%3A00.000Z"))
            ApiHttp.Resposta(200, """{"dados":[],"pagina":2,"limite":20,"total":1,"ate":"$instante"}""")
        }
        val pagina = api.listar("t", 2, instante)
        assertEquals(instante, pagina.ate)
        assertTrue(pagina.dados.isEmpty())
    }
}
