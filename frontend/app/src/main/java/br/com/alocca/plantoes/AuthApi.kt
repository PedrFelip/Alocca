package br.com.alocca.plantoes

import org.json.JSONObject
import android.util.Base64
import java.net.HttpURLConnection
import java.net.URL

internal data class ApiResult(val successful: Boolean, val body: JSONObject?, val message: String)

internal object AuthApi {
    private const val LOGIN_PATH = "auth/login"
    private const val REGISTER_PATH = "auth/register/medico"
    private const val INVALID_RESPONSE = "O servidor retornou uma resposta inválida. Tente novamente."

    fun post(path: String, payload: JSONObject): ApiResult {
        var connection: HttpURLConnection? = null
        return try {
            connection = (URL(BuildConfig.API_BASE_URL + path).openConnection() as HttpURLConnection).apply {
                requestMethod = "POST"
                connectTimeout = 10_000
                readTimeout = 15_000
                doOutput = true
                setRequestProperty("Content-Type", "application/json; charset=utf-8")
            }
            connection.outputStream.use { it.write(payload.toString().toByteArray(Charsets.UTF_8)) }
            val status = connection.responseCode
            val text = (if (status in 200..299) connection.inputStream else connection.errorStream)
                ?.bufferedReader(Charsets.UTF_8)?.use { it.readText() }.orEmpty()
            val body = runCatching { JSONObject(text) }.getOrNull()
            if (status in 200..299) {
                when (path) {
                    LOGIN_PATH -> if (body.hasValidLoginResponse()) ApiResult(true, body, "")
                        else ApiResult(false, null, INVALID_RESPONSE)
                    REGISTER_PATH -> if (body.hasValidRegistrationResponse()) ApiResult(true, body, "")
                        else ApiResult(false, null, INVALID_RESPONSE)
                    else -> ApiResult(false, null, "Operação não suportada.")
                }
            } else {
                ApiResult(false, body, body?.optString("message")?.takeIf(String::isNotBlank) ?: "Não foi possível concluir. Tente novamente.")
            }
        } catch (_: Exception) {
            ApiResult(false, null, "Não foi possível conectar ao servidor. Verifique sua conexão e a URL do backend.")
        } finally {
            connection?.disconnect()
        }
    }

    private fun JSONObject?.hasValidLoginResponse(): Boolean {
        val token = this?.optString("access_token")?.trim().orEmpty()
        // O backend emite JWTs. Exigir estrutura e claims básicos evita aceitar
        // respostas 2xx que não representam uma sessão utilizável.
        val parts = token.split('.')
        if (parts.size != 3 || parts.any(String::isBlank)) return false
        return runCatching {
            val header = JSONObject(String(Base64.decode(parts[0], Base64.URL_SAFE or Base64.NO_WRAP or Base64.NO_PADDING), Charsets.UTF_8))
            val claims = JSONObject(String(Base64.decode(parts[1], Base64.URL_SAFE or Base64.NO_WRAP or Base64.NO_PADDING), Charsets.UTF_8))
            val signature = Base64.decode(parts[2], Base64.URL_SAFE or Base64.NO_WRAP or Base64.NO_PADDING)
            header.optString("alg").isNotBlank() && !header.optString("alg").equals("none", ignoreCase = true) &&
                claims.optString("sub").isNotBlank() && signature.isNotEmpty()
        }.getOrDefault(false)
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
}
