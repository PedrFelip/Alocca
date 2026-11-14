package br.com.alocca.plantoes

import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class GestorConsultasTest {
    @Test fun `medico preserva crm uf e especialidade ausente sem inventar dados`() {
        val item = GestorConsultasApi.parseItem(JSONObject("""{"id":"m1","nome":"Ana","crm":"00123","uf_crm":"SP","especialidade":null,"status":"ATIVO","status_validacao":"APROVADO"}"""), false)
        assertEquals("Ana", item.titulo)
        assertTrue(item.detalhe.contains("00123/SP"))
        assertTrue(item.detalhe.contains("Especialidade não informada"))
        assertFalse(item.detalhe.contains("null"))
    }

    @Test fun `ponto sem gps nao afirma validacao de localizacao`() {
        val item = GestorConsultasApi.parseItem(JSONObject("""{"id":"r1","tipo_evento":"SAIDA","timestamp_servidor":"2026-11-14T20:00:00.000Z","com_localizacao":false,"medico":{"nome":"Ana","crm":"123","uf_crm":"SP"},"instituicao":{"nome":"Hospital"},"plantao":{"titulo":"Plantão"}}"""), true)
        assertEquals("Ana • Saída", item.titulo)
        assertTrue(item.detalhe.contains("Sem localização informada"))
        assertTrue(item.detalhe.contains("Hospital"))
        assertFalse(item.detalhe.contains("validada"))
    }

    @Test(expected = IllegalArgumentException::class)
    fun `data invalida nao vira um registro ficticio`() {
        GestorConsultasApi.parseItem(JSONObject("""{"id":"r1","tipo_evento":"ENTRADA","timestamp_servidor":"invalido","com_localizacao":true,"medico":{"nome":"Ana"}}"""), true)
    }
}
