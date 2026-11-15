package br.com.alocca.plantoes

import org.junit.Assert.*
import org.junit.Test
import java.math.BigDecimal

class GestorIndicadoresTest {
    private val json = """{"periodo":"todo_historico","atualizado_em":"2026-11-14T20:00:00.000Z","plantoes":3,"medicos_vinculados":2,"vagas_preenchidas":4,"pagamentos":{"total_pago":"123456789012345.67","total_a_pagar":"0.10","total_em_atraso":"2.35"}}"""
    @Test fun `busca envia rota metodo e token e preserva totais decimais`() {
        val cliente = GestorIndicadoresCliente { path, method, token ->
            assertEquals("gestor/indicadores", path); assertEquals("GET", method); assertEquals("token-gestor", token)
            ApiHttp.Resposta(200, json)
        }
        val d = cliente.buscar("token-gestor")
        assertEquals(3, d.plantoes); assertEquals(2, d.medicos); assertEquals(4, d.vagas)
        assertEquals(BigDecimal("123456789012345.67"), d.pago); assertEquals(BigDecimal("0.10"), d.aPagar); assertEquals(BigDecimal("2.35"), d.atrasado)
        assertFalse(d.vazio); assertTrue(formatarValorIndicador(d.aPagar).contains("0,10"))
    }
    @Test fun `vazio exige todos os contadores e valores zerados`() {
        val zero = json.replace("\"plantoes\":3", "\"plantoes\":0").replace("\"medicos_vinculados\":2", "\"medicos_vinculados\":0").replace("\"vagas_preenchidas\":4", "\"vagas_preenchidas\":0").replace("123456789012345.67", "0.00").replace("0.10", "0").replace("2.35", "0.00")
        assertTrue(GestorIndicadoresCliente { _, _, _ -> ApiHttp.Resposta(200, zero) }.buscar("t").vazio)
    }
    @Test fun `respostas invalidas nao criam indicadores`() {
        val invalidos = listOf(json.replace("todo_historico", "mes"), json.replace("2026-11-14T20:00:00.000Z", "invalida"), json.replace("\"0.10\"", "0.10"), json.replace("\"plantoes\":3", "\"plantoes\":-1"), "{}")
        invalidos.forEach { body ->
            val erro = runCatching { GestorIndicadoresCliente { _, _, _ -> ApiHttp.Resposta(200, body) }.buscar("t") }.exceptionOrNull()
            assertTrue(erro is ApiException); assertEquals("O servidor retornou uma resposta inválida.", (erro as ApiException).userMessage)
        }
    }
    @Test fun `erros preservam status inclusive sessao expirada e falha de conexao`() {
        for (status in listOf(0, 401, 403, 500)) {
            val erro = runCatching { GestorIndicadoresCliente { _, _, _ -> ApiHttp.Resposta(status, "{}") }.buscar("t") }.exceptionOrNull() as ApiException
            assertEquals(status, erro.status); assertTrue(erro.userMessage.isNotBlank())
            if (status == 0) assertEquals(ApiHttp.CONNECTION_ERROR, erro.userMessage)
        }
    }
}
