package br.com.alocca.plantoes

import java.util.TimeZone
import org.junit.After
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test

class PlantoesScreenRowsTest {
    private val fusoOriginal = TimeZone.getDefault()

    @Before fun `fixa fuso UTC para datas previsiveis`() = TimeZone.setDefault(TimeZone.getTimeZone("UTC"))

    @After fun `restaura fuso original`() = TimeZone.setDefault(fusoOriginal)


    private fun turno(
        id: String = "p1",
        titulo: String = "Turno",
        instituicao: String = "",
        especialidade: String = "",
        local: String = "",
        inicio: String = "",
        fim: String = "",
        valor: String? = null,
        status: String = "",
    ) = ItemPlantao(id = id, titulo = titulo, instituicao = instituicao, especialidade = especialidade, local = local, inicio = inicio, fim = fim, valor = valor, status = status)

    @Test fun `candidate rows carry display fields and keep source item`() {
        val item = ItemPlantao(id = "c1", medico = "Ana", crm = "012345", status = "PENDENTE", mensagem = "Disponível")
        val linha = linhasPlantoes(listOf(item), modoCandidaturas = true).single() as LinhaPlantoes.Candidatura
        assertEquals("c1", linha.item.id)
        assertEquals("Ana", linha.nomeMedico)
        assertEquals("CRM: 012345  •  PENDENTE", linha.crmStatus)
        assertEquals("Disponível", linha.mensagem)
    }

    @Test fun `candidate rows fall back to default doctor name and hide blank message`() {
        val item = ItemPlantao(id = "c2", medico = "", crm = "", status = "APROVADA", mensagem = "")
        val linha = linhasPlantoes(listOf(item), modoCandidaturas = true).single() as LinhaPlantoes.Candidatura
        assertEquals("Médico", linha.nomeMedico)
        assertEquals("CRM:   •  APROVADA", linha.crmStatus)
        assertNull(linha.mensagem)
    }

    @Test fun `shift rows join non blank details and format period`() {
        val linha = linhasPlantoes(
            listOf(turno(instituicao = "Hospital", especialidade = "", local = "Centro", inicio = "2026-11-20T10:00:00.000Z", fim = "2026-11-20T18:00:00.000Z", valor = "1800.00")),
            modoCandidaturas = false,
        ).single() as LinhaPlantoes.Turno
        assertEquals("p1", linha.item.id)
        assertEquals("Hospital • Centro", linha.detalhes)
        assertEquals("20/11/2026 • 10:00 — 20/11/2026 • 18:00", linha.periodo)
    }

    @Test fun `shift rows keep only shift data when list is empty of details`() {
        val linha = linhasPlantoes(listOf(turno(id = "p2", valor = null)), modoCandidaturas = false).single() as LinhaPlantoes.Turno
        assertEquals("", linha.detalhes)
        assertEquals(" — ", linha.periodo)
        assertNull(linha.item.valor)
    }

    @Test fun `mode selects row kind without losing rows`() {
        val itens = listOf(turno(id = "p1"), ItemPlantao(id = "c1", medico = "Ana"))
        val candidaturas = linhasPlantoes(itens, modoCandidaturas = true)
        assertEquals(2, candidaturas.size)
        assertTrue(candidaturas.all { it is LinhaPlantoes.Candidatura })
        val turnos = linhasPlantoes(itens, modoCandidaturas = false)
        assertEquals(2, turnos.size)
        assertTrue(turnos.all { it is LinhaPlantoes.Turno })
        assertTrue(linhasPlantoes(emptyList(), modoCandidaturas = true).isEmpty())
    }
}
