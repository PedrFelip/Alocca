package br.com.alocca.plantoes

import android.util.Base64
import org.json.JSONObject

internal data class ApiResult(
    val successful: Boolean,
    val body: JSONObject?,
    val message: String,
    val status: Int = 0,
)

internal object AuthApi {
    private const val LOGIN_PATH = "auth/login"
    private const val REGISTER_PATH = "auth/register/medico"
    private const val PROFILE_PATH = "usuarios/me"
    private const val INVALID_RESPONSE = "O servidor retornou uma resposta inválida. Tente novamente."

    // Mensagens oficiais por código HTTP, seguindo o contrato (MSG-01, MSG-02, MSG-03).
    // O aplicativo usa a mensagem exata do servidor quando ela já é humana; estas
    // cobrem respostas sem corpo útil (ex.: 429 do throttler do Nest).
    private const val MSG_01 = "E-mail, CPF, CRM ou senha incorretos."
    private const val MSG_02 = "Este dado (E-mail/CPF/CRM) já pertence a uma conta ativa."
    private const val MSG_03 = "Conta bloqueada temporariamente. Tente novamente em 15 minutos."
    private const val FALHA_GENERICA = "Não foi possível concluir. Tente novamente."
    private const val MUITOS_PEDIDOS = "Muitas tentativas. Aguarde um minuto e tente de novo."

    fun post(path: String, payload: JSONObject): ApiResult {
        val result = request(path, "POST", payload = payload)
        if (!result.successful) return result
        return when (path) {
            LOGIN_PATH -> if (result.body.hasValidLoginResponse()) result
            else ApiResult(false, null, INVALID_RESPONSE, result.status)
            REGISTER_PATH -> if (result.body.hasValidRegistrationResponse()) result
            else ApiResult(false, null, INVALID_RESPONSE, result.status)
            else -> ApiResult(false, null, "Operação não suportada.", result.status)
        }
    }

    /** O login mobile entrega somente um desafio; nenhum token de sessão antes do PIN. */
    fun iniciarLogin(tipo: String, email: String, senha: String): ApiResult {
        require(tipo == "medico" || tipo == "gestor")
        return interpretarChallenge(request("auth/login/$tipo", "POST", JSONObject().put("email", email).put("senha", senha)))
    }

    fun solicitarPin(challenge: String): ApiResult =
        postMensagem("auth/2fa/solicitar-pin", JSONObject().put("challenge_token", challenge))

    fun validarPin(challenge: String, pin: String): ApiResult = interpretarSessao(
        request("auth/2fa/validar-pin", "POST", JSONObject().put("challenge_token", challenge).put("pin_code", pin)),
    )

    fun renovar(refresh: String): ApiResult = interpretarSessao(
        request("auth/refresh", "POST", JSONObject().put("refresh_token", refresh)),
    )

    fun revogar(refresh: String): ApiResult =
        request("auth/logout", "POST", JSONObject().put("refresh_token", refresh))

    internal fun interpretarChallenge(result: ApiResult): ApiResult {
        if (!result.successful) return result
        val body = result.body
        return if (body != null && body.optString("challenge_token").isNotBlank() &&
            body.optBoolean("requer_2fa", false) && body.optLong("expires_in", 0) > 0 &&
            !body.has("access_token") && !body.has("refresh_token")) result
        else ApiResult(false, null, INVALID_RESPONSE, result.status)
    }

    internal fun interpretarSessao(result: ApiResult): ApiResult {
        if (!result.successful) return result
        val body = result.body
        return if (body.hasValidLoginResponse() && body!!.optString("refresh_token").isNotBlank() &&
            body.optString("token_type").equals("Bearer", ignoreCase = true) &&
            body.optLong("expires_in", 0) > 0 && body.optLong("refresh_expires_in", 0) > 0) result
        else ApiResult(false, null, INVALID_RESPONSE, result.status)
    }

    // recuperacao de senha (UC04): a resposta so traz a mensagem
    fun recuperarSenha(email: String): ApiResult =
        postMensagem("auth/recuperar-senha", JSONObject().put("email", email))

    fun redefinirSenha(codigo: String, novaSenha: String): ApiResult =
        postMensagem("auth/redefinir-senha", JSONObject().put("token", codigo).put("nova_senha", novaSenha))

    fun alterarSenha(token: String, senhaAtual: String, novaSenha: String): ApiResult =
        interpretarAlteracaoSenha(request("auth/alterar-senha", "POST", JSONObject().put("senha_atual", senhaAtual).put("nova_senha", novaSenha), token))

    internal fun interpretarAlteracaoSenha(result: ApiResult): ApiResult = when {
        result.status == 200 -> result.copy(successful = true, message = "Senha atualizada com sucesso!")
        result.successful -> ApiResult(false, null, INVALID_RESPONSE, result.status)
        result.status == 429 -> result.copy(message = result.body?.optString("message")?.takeIf { it.isNotBlank() } ?: MUITOS_PEDIDOS)
        else -> result
    }

    private fun postMensagem(path: String, payload: JSONObject): ApiResult {
        val result = request(path, "POST", payload = payload)
        // aqui o 429 e o limite de pedidos, nao conta bloqueada
        if (result.status == 429) return result.copy(message = MUITOS_PEDIDOS)
        if (!result.successful) return result
        val mensagem = result.body?.optString("message").orEmpty()
        return if (mensagem.isBlank()) ApiResult(false, null, INVALID_RESPONSE, result.status)
        else result.copy(message = mensagem)
    }

    /** Consulta o perfil autenticado para validar uma sessão restaurada. */
    fun getProfile(token: String): ApiResult {
        val result = request(PROFILE_PATH, "GET", token = token)
        if (!result.successful) return result
        return if (result.body.hasValidProfileResponse()) result
        else ApiResult(false, null, INVALID_RESPONSE, result.status)
    }

    private fun request(
        path: String,
        method: String,
        payload: JSONObject? = null,
        token: String? = null,
    ): ApiResult {
        val resposta = ApiHttp.enviar(path, method, payload, token)
        if (resposta.status == 0) return ApiResult(false, null, ApiHttp.CONNECTION_ERROR)
        val body = runCatching { JSONObject(resposta.texto) }.getOrNull()
        return if (resposta.status in 200..299) {
            ApiResult(true, body, "", resposta.status)
        } else {
            ApiResult(false, body, mensagemDeErro(resposta.status, body), resposta.status)
        }
    }

    /** Erros de rede (status 0) têm mensagem própria; 401/409/429 usam as MSG oficiais. */
    private fun mensagemDeErro(status: Int, body: JSONObject?): String = when (status) {
        401 -> MSG_01
        409 -> MSG_02
        429 -> MSG_03
        else -> body?.optString("message")?.takeIf(String::isNotBlank) ?: FALHA_GENERICA
    }

    private fun JSONObject?.hasValidLoginResponse(): Boolean {
        val response = this ?: return false
        val token = response.optString("access_token").trim()
        // O backend emite JWTs. Exigir estrutura e claims básicos evita aceitar
        // respostas 2xx que não representam uma sessão utilizável.
        val parts = token.split('.')
        if (parts.size != 3 || parts.any(String::isBlank)) return false
        val validJwt = runCatching {
            val header = JSONObject(
                String(
                    Base64.decode(parts[0], Base64.URL_SAFE or Base64.NO_WRAP or Base64.NO_PADDING),
                    Charsets.UTF_8,
                ),
            )
            val claims = JSONObject(
                String(
                    Base64.decode(parts[1], Base64.URL_SAFE or Base64.NO_WRAP or Base64.NO_PADDING),
                    Charsets.UTF_8,
                ),
            )
            val signature = Base64.decode(parts[2], Base64.URL_SAFE or Base64.NO_WRAP or Base64.NO_PADDING)
            header.optString("alg").isNotBlank() &&
                !header.optString("alg").equals("none", ignoreCase = true) &&
                claims.optString("sub").isNotBlank() &&
                signature.isNotEmpty()
        }.getOrDefault(false)
        return validJwt && response.optJSONObject("usuario").hasValidProfileResponse()
    }

    private fun JSONObject?.hasValidRegistrationResponse(): Boolean {
        val response = this ?: return false
        val medico = response.optJSONObject("medico") ?: return false
        return response.optString("id").isNotBlank() &&
            response.optString("email").isNotBlank() &&
            response.optString("tipo") == "MEDICO" &&
            !medico.optString("crm").isNullOrBlank() &&
            !medico.optString("uf_crm").isNullOrBlank()
    }

    private fun JSONObject?.hasValidProfileResponse(): Boolean {
        val response = this ?: return false
        return response.optString("id").isNotBlank() &&
            response.optString("nome").isNotBlank() &&
            response.optString("email").isNotBlank() &&
            response.optString("tipo").isNotBlank() &&
            response.optString("status").isNotBlank()
    }
}
