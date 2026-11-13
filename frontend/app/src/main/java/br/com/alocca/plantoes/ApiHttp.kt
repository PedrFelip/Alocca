package br.com.alocca.plantoes

import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

/**
 * Transporte HTTP compartilhado pelas APIs do app (AuthApi, PlantoesApi).
 * Só abre conexão, envia/recebe e devolve status + texto bruto; o parse de
 * JSON e as mensagens de erro ficam com cada API (SRP).
 */
internal object ApiHttp {
    const val CONNECTION_ERROR =
        "Não foi possível conectar ao servidor. Verifique sua conexão e a URL do backend."

    /** `status == 0` significa falha de conexão (sem resposta HTTP). */
    internal data class Resposta(val status: Int, val texto: String)

    fun enviar(
        path: String,
        method: String,
        payload: JSONObject? = null,
        token: String? = null,
    ): Resposta {
        var connection: HttpURLConnection? = null
        return try {
            connection = (URL(BuildConfig.API_BASE_URL + path).openConnection() as HttpURLConnection).apply {
                requestMethod = method
                connectTimeout = 10_000
                readTimeout = 15_000
                if (payload != null) {
                    doOutput = true
                    setRequestProperty("Content-Type", "application/json; charset=utf-8")
                }
                if (token != null) setRequestProperty("Authorization", "Bearer $token")
            }
            if (payload != null) {
                connection.outputStream.use { it.write(payload.toString().toByteArray(Charsets.UTF_8)) }
            }
            val status = connection.responseCode
            val text = (if (status in 200..299) connection.inputStream else connection.errorStream)
                ?.bufferedReader(Charsets.UTF_8)?.use { it.readText() }.orEmpty()
            Resposta(status, text)
        } catch (_: Exception) {
            Resposta(0, "")
        } finally {
            connection?.disconnect()
        }
    }
}
