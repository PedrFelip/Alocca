package br.com.alocca.plantoes

import org.junit.Assert.*
import org.junit.Test

class PinUiTest {
    @Test fun pinRequiresExactlySixAsciiDigits() {
        assertTrue(pinValido("012345"))
        assertFalse(pinValido("12345"))
        assertFalse(pinValido("1234567"))
        assertFalse(pinValido("12345a"))
        assertFalse(pinValido("１２３４５６"))
    }

    @Test fun challengeExpiresAtItsDeadline() {
        assertFalse(challengeExpirado(999, 1000))
        assertTrue(challengeExpirado(1000, 1000))
        assertTrue(challengeExpirado(1001, 1000))
    }
}
