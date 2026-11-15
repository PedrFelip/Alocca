package br.com.alocca.plantoes

import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class AlterarSenhaTest {
    @Test fun validaSenhaEConfirmacao() {
        assertTrue(validarAlteracaoSenha("", "Senha123", "Senha123").isNotEmpty())
        for (senha in listOf("Senh123", "senha123", "SENHA123", "SenhaSegura")) {
            assertTrue(validarAlteracaoSenha("atual", senha, senha).isNotEmpty())
        }
        assertTrue(validarAlteracaoSenha("atual", "Senha123", "Senha124").isNotEmpty())
        assertEquals("", validarAlteracaoSenha("atual", "Senha123", "Senha123"))
    }

    @Test fun interpretaSucessoEErros() {
        val sucesso = AuthApi.interpretarAlteracaoSenha(ApiResult(true, JSONObject(), "", 200))
        assertTrue(sucesso.successful)
        assertEquals("Senha atualizada com sucesso!", sucesso.message)
        assertFalse(AuthApi.interpretarAlteracaoSenha(ApiResult(true, null, "", 201)).successful)
        val erro = ApiResult(false, JSONObject().put("message", "Senha atual incorreta"), "Senha atual incorreta", 400)
        assertEquals(erro, AuthApi.interpretarAlteracaoSenha(erro))
        val expirado = ApiResult(false, null, "Não autorizado", 401)
        assertEquals(401, AuthApi.interpretarAlteracaoSenha(expirado).status)
        val limite = ApiResult(false, JSONObject().put("message", "Aguarde"), "", 429)
        assertEquals("Aguarde", AuthApi.interpretarAlteracaoSenha(limite).message)
        assertTrue(AuthApi.interpretarAlteracaoSenha(limite.copy(body = null)).message.isNotBlank())
    }
}
