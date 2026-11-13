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
