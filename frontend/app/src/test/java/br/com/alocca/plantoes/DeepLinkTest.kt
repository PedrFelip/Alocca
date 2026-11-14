package br.com.alocca.plantoes

import org.junit.Assert.*
import org.junit.Test

class DeepLinkTest {
    private val uuid = "123E4567-E89B-12D3-A456-426614174000"

    @Test fun `uuid valido normaliza em minusculas`() {
        assertEquals(uuid.lowercase(), DeepLink.validar(uuid))
        assertEquals(uuid.lowercase(), DeepLink.validar("  $uuid  "))
    }

    @Test fun `valor invalido nunca vira deep link`() {
        for (valor in listOf(null, "", "   ", "../admin", "n1", "$uuid-x", "123e4567e89b12d3a456426614174000")) {
            assertNull("deveria rejeitar: $valor", DeepLink.validar(valor))
        }
    }
}
