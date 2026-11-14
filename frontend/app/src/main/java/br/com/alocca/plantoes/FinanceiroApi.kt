package br.com.alocca.plantoes

import android.content.Context
import android.net.Uri
import android.provider.OpenableColumns
import org.json.JSONArray
import org.json.JSONObject
import java.math.BigDecimal
import java.net.HttpURLConnection
import java.net.URL
import java.util.UUID

internal data class PendenteBaixa(val id: String, val medico: String, val plantao: String, val instituicao: String, val valor: BigDecimal)
internal data class ComprovanteArquivo(val nome: String, val mime: String, val bytes: ByteArray)

internal object FinanceiroApi : FinanceiroCliente(BuildConfig.API_BASE_URL)

internal open class FinanceiroCliente(private val baseUrl: String) {
    companion object { const val LIMITE = 5 * 1024 * 1024 }

    fun pendentes(token: String): Resposta<List<PendenteBaixa>> {
        val r = conectar("financeiro/pendentes-baixa", token) { c ->
            val status = c.responseCode
            val texto = (if (status in 200..299) c.inputStream else c.errorStream)?.bufferedReader()?.use { it.readText() }.orEmpty()
            if (status in 200..299) Resposta.Ok(texto) else falha(status, texto)
        }
        if (r is Resposta.Falha) return r
        val texto = (r as Resposta.Ok).dados
        return runCatching {
            val lista = JSONArray(texto)
            Resposta.Ok(List(lista.length()) { i ->
                val p = lista.getJSONObject(i)
                PendenteBaixa(p.getString("id"), p.getJSONObject("medico").getString("nome"), p.getJSONObject("plantao").getString("titulo"), p.getJSONObject("instituicao").getString("nome"), BigDecimal(p.getString("valor")))
            })
        }.getOrElse { Resposta.Falha("Resposta inválida do servidor.", 0) }
    }

    fun lerArquivo(context: Context, uri: Uri): Resposta<ComprovanteArquivo> = try {
        val nome = context.contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { cursor ->
            if (cursor.moveToFirst()) cursor.getString(0) else null
        }.orEmpty()
        val extensao = nome.substringAfterLast('.', "").lowercase()
        val mime = when (extensao) { "pdf" -> "application/pdf"; "jpg", "jpeg" -> "image/jpeg"; "png" -> "image/png"; else -> null }
        if (mime == null) Resposta.Falha("Escolha um arquivo PDF, JPG ou PNG.", 400)
        else {
            val bytes = context.contentResolver.openInputStream(uri)?.use { it.readBytesLimitados() }
            if (bytes == null || bytes.isEmpty() || bytes.size > LIMITE) Resposta.Falha("O comprovante deve ter até 5 MB e não pode estar vazio.", 400)
            else Resposta.Ok(ComprovanteArquivo("comprovante.$extensao", mime, bytes))
        }
    } catch (_: Exception) { Resposta.Falha("Não foi possível ler o arquivo selecionado.", 0) }

    fun baixar(token: String, id: String): Resposta<ComprovanteArquivo> = conectar("financeiro/comprovantes/$id", token) { c ->
        val status = c.responseCode
        if (status !in 200..299) falha(status, c.errorStream?.bufferedReader()?.use { it.readText() }.orEmpty())
        else {
            val mime = c.contentType?.substringBefore(';')
            val extensao = when (mime) { "application/pdf" -> "pdf"; "image/jpeg" -> "jpg"; "image/png" -> "png"; else -> null }
            val bytes = c.inputStream.use { it.readBytesLimitados() }
            if (extensao == null || bytes.isEmpty() || bytes.size > LIMITE) Resposta.Falha("Comprovante inválido recebido do servidor.", 0)
            else Resposta.Ok(ComprovanteArquivo("comprovante-$id.$extensao", mime!!, bytes))
        }
    }

    fun darBaixa(token: String, id: String, arquivo: ComprovanteArquivo): Resposta<String> = conectar("financeiro/pagamentos/$id/dar-baixa", token) { c ->
        val boundary = "Alocca${UUID.randomUUID()}"
        c.requestMethod = "POST"
        c.doOutput = true
        c.setRequestProperty("Content-Type", "multipart/form-data; boundary=$boundary")
        c.outputStream.use { out ->
            out.write("--$boundary\r\nContent-Disposition: form-data; name=\"comprovante\"; filename=\"${arquivo.nome}\"\r\nContent-Type: ${arquivo.mime}\r\n\r\n".toByteArray())
            out.write(arquivo.bytes)
            out.write("\r\n--$boundary--\r\n".toByteArray())
        }
        val status = c.responseCode
        val texto = (if (status in 200..299) c.inputStream else c.errorStream)?.bufferedReader()?.use { it.readText() }.orEmpty()
        if (status in 200..299) Resposta.Ok(JSONObject(texto).getString("message")) else falha(status, texto)
    }

    private fun java.io.InputStream.readBytesLimitados(): ByteArray {
        val out = java.io.ByteArrayOutputStream()
        val buffer = ByteArray(8192)
        while (out.size() <= LIMITE) {
            val lidos = read(buffer, 0, minOf(buffer.size, LIMITE + 1 - out.size()))
            if (lidos < 0) break
            out.write(buffer, 0, lidos)
        }
        return out.toByteArray()
    }

    private fun <T> conectar(path: String, token: String, executar: (HttpURLConnection) -> Resposta<T>): Resposta<T> {
        return ApiHttp.autenticado<Resposta<T>>(token, { status -> falha(status, "") }) { actual ->
            var c: HttpURLConnection? = null
            try {
                c = (URL(baseUrl + path).openConnection() as HttpURLConnection).apply {
                    connectTimeout = 10_000; readTimeout = 30_000; instanceFollowRedirects = false
                    setRequestProperty("Authorization", "Bearer $actual")
                }
                val result = executar(c)
                val status = c.responseCode
                status to result
            } catch (_: Exception) { 0 to Resposta.Falha(ApiHttp.CONNECTION_ERROR, 0) }
            finally { c?.disconnect() }
        }.second
    }

    private fun falha(status: Int, texto: String): Resposta.Falha {
        val mensagem = when (status) {
            401 -> "Sua sessão expirou. Entre novamente."
            404 -> "Pagamento ou comprovante não encontrado. Atualize a lista."
            0 -> ApiHttp.CONNECTION_ERROR
            else -> runCatching { JSONObject(texto).optString("message") }.getOrNull()?.takeIf { it.isNotBlank() }
                ?: "Não foi possível concluir a operação. Tente novamente."
        }
        return Resposta.Falha(mensagem, status)
    }
}
