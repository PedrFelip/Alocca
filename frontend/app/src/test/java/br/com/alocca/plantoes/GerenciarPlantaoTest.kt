package br.com.alocca.plantoes

import org.junit.Assert.*
import org.junit.Test

class GerenciarPlantaoTest {
    private val plantao = PlantaoGerenciado("p1", "UTI", "Intensiva", "Unidade", "2030-01-01T10:00:00.000Z", "2030-01-02T10:00:00.000Z", "100.00", 3, 1, "ABERTO", "Hospital", "Nota")
    private fun edicao() = EdicaoPlantao(plantao.titulo, plantao.especialidade, plantao.localUnidade, plantao.descricao, PlantoesApi.dataLocal(plantao.dataInicio), PlantoesApi.formatarHora(plantao.dataInicio), PlantoesApi.dataLocal(plantao.dataFim), PlantoesApi.formatarHora(plantao.dataFim), plantao.valor, "3")

    @Test fun `acoes respeitam status e limites de tempo`() {
        val inicio = PlantoesApi.parseIso(plantao.dataInicio)!!.time
        val fim = PlantoesApi.parseIso(plantao.dataFim)!!.time
        assertTrue(PlantoesApi.podeEditarOuCancelar(plantao, inicio - 1))
        assertFalse(PlantoesApi.podeEditarOuCancelar(plantao, inicio))
        assertFalse(PlantoesApi.podeConcluir(plantao, fim - 1))
        assertTrue(PlantoesApi.podeConcluir(plantao.copy(status = "PREENCHIDO"), fim))
        assertFalse(PlantoesApi.podeConcluir(plantao.copy(status = "CANCELADO"), fim))
        assertFalse(PlantoesApi.podeEditarOuCancelar(plantao.copy(dataInicio = "inválida"), 0))
    }

    @Test fun `payload parcial preserva instituicao e datas inalteradas`() {
        val payload = edicao().copy(local = "Outro local").payload(plantao, 0)
        assertEquals(1, payload.length())
        assertEquals("Outro local", payload.getString("local_unidade"))
        assertFalse(payload.has("instituicao_id"))
        assertEquals(0, edicao().payload(plantao, 0).length())
    }

    @Test fun `recusa vagas abaixo das preenchidas e datas invertidas`() {
        assertThrows(IllegalArgumentException::class.java) { edicao().copy(vagas = "1").payload(plantao, 0) }
        assertThrows(IllegalArgumentException::class.java) { edicao().copy(dataFim = "01/01/2020").payload(plantao, 0) }
        assertThrows(IllegalArgumentException::class.java) { edicao().copy(descricao = "").payload(plantao, 0) }
    }

    @Test fun `valida resposta e preserva mensagem de erro do servidor`() {
        assertEquals("Salvo", PlantoesApi.validarRespostaOperacao(ApiHttp.Resposta(200, """{"message":"Salvo","plantao":{"id":"p1"}}""")))
        assertThrows(ApiException::class.java) { PlantoesApi.validarRespostaOperacao(ApiHttp.Resposta(200, "{}")) }
        val erro = assertThrows(ApiException::class.java) { PlantoesApi.validarRespostaOperacao(ApiHttp.Resposta(409, """{"message":"Plantão já iniciado"}""")) }
        assertEquals("Plantão já iniciado", erro.userMessage)
    }
}
