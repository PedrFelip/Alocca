package br.com.alocca.plantoes

import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.runBlocking
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class PlantoesRepositoryTest {
    private class Transport(var response: Resultado<String> = Resultado.Sucesso("[]")) : PlantoesTransport {
        val calls = mutableListOf<Pair<String, JSONObject?>>()
        override suspend fun request(path: String, body: JSONObject?): Resultado<String> {
            calls += path to body
            return response
        }
    }

    @Test fun `list routes preserve pagination and identifiers`() = runBlocking {
        val transport = Transport()
        val repository = HttpPlantoesRepository(transport)
        repository.feed(2)
        repository.minhasCandidaturas(1)
        repository.plantoesGestor()
        repository.candidatos("plantao-1")
        assertEquals(listOf(
            "plantoes?limit=20&offset=40", "candidaturas/medico?limit=20&offset=20",
            "plantoes/gestor", "plantoes/plantao-1/candidaturas",
        ), transport.calls.map { it.first })
        assertTrue(transport.calls.all { it.second == null })
    }

    @Test fun `maps feed institution and numeric value without losing precision`() = runBlocking {
        val transport = Transport(Resultado.Sucesso("""[{"id":"p1","titulo":" Turno ","instituicao":{"nome":" Hospital "},"valor":"1234.50","local_unidade":null}]"""))
        val item = (HttpPlantoesRepository(transport).feed(0) as Resultado.Sucesso).valor.single()
        assertEquals("p1", item.id)
        assertEquals("Turno", item.titulo)
        assertEquals("Hospital", item.instituicao)
        assertEquals("1234.50", item.valor)
        assertEquals("", item.local)
        transport.response = Resultado.Sucesso("""[{"id":"p2","instituicao":"Clínica","valor":100}]""")
        val flat = (HttpPlantoesRepository(transport).plantoesGestor() as Resultado.Sucesso).valor.single()
        assertEquals("Clínica", flat.instituicao)
        assertEquals("100", flat.valor)
    }

    @Test fun `application keeps application id and maps nested shift`() = runBlocking {
        val transport = Transport(Resultado.Sucesso("""[{"id":"c1","status":"PENDENTE","mensagem_medico":null,"plantao":{"id":"p1","titulo":"UTI","especialidade":"Intensivista","local_unidade":"Centro","data_inicio":"inicio","data_fim":"fim","valor":null},"instituicao":{"nome":"Hospital"}}]"""))
        val item = (HttpPlantoesRepository(transport).minhasCandidaturas(0) as Resultado.Sucesso).valor.single()
        assertEquals(ItemPlantao(id = "c1", titulo = "UTI", instituicao = "Hospital", especialidade = "Intensivista", local = "Centro", inicio = "inicio", fim = "fim", status = "PENDENTE"), item)
    }

    @Test fun `maps candidate doctor and message`() = runBlocking {
        val transport = Transport(Resultado.Sucesso("""[{"id":"c1","status":"PENDENTE","medico":{"nome":"Ana","crm":"012345"},"mensagem_medico":" Disponível "}]"""))
        val item = (HttpPlantoesRepository(transport).candidatos("p1") as Resultado.Sucesso).valor.single()
        assertEquals("Ana", item.medico)
        assertEquals("012345", item.crm)
        assertEquals("Disponível", item.mensagem)
    }

    @Test fun `writes trimmed optional message and approval payload`() = runBlocking {
        val transport = Transport(Resultado.Sucesso(""))
        val repository = HttpPlantoesRepository(transport)
        assertEquals(Resultado.Sucesso(Unit), repository.candidatar("p1", "  Olá  "))
        assertEquals("plantoes/p1/candidaturas", transport.calls.last().first)
        assertEquals("Olá", transport.calls.last().second!!.getString("mensagem"))
        repository.candidatar("p1", "   ")
        assertEquals(0, transport.calls.last().second!!.length())
        assertEquals(Resultado.Sucesso(Unit), repository.aprovar("p1", "c1"))
        assertEquals("plantoes/p1/candidaturas/c1/aprovar", transport.calls.last().first)
        assertEquals(0, transport.calls.last().second!!.length())
    }

    @Test fun `rejects invalid lists and missing identifiers`() = runBlocking {
        for (body in listOf("bad json", "{}", "[null]", "[{}]", "[{\"id\":null}]", "[{\"id\":\" \"}]")) {
            assertTrue(body, HttpPlantoesRepository(Transport(Resultado.Sucesso(body))).feed(0) is Resultado.Erro)
        }
    }

    @Test fun `propagates server errors for reads and writes`() = runBlocking {
        val error = Resultado.Erro("Sem permissão")
        val repository = HttpPlantoesRepository(Transport(error))
        assertEquals(error, repository.feed(0))
        assertEquals(error, repository.candidatar("p1", ""))
        assertEquals(error, repository.aprovar("p1", "c1"))
    }

    @Test fun `does not convert coroutine cancellation into an error`() {
        val cancellation = CancellationException("Tela fechada")
        val repository = HttpPlantoesRepository(PlantoesTransport { _, _ -> throw cancellation })
        try {
            runBlocking { repository.feed(0) }
            fail("Cancellation must propagate")
        } catch (actual: CancellationException) {
            assertSame(cancellation, actual)
        }
    }
}
