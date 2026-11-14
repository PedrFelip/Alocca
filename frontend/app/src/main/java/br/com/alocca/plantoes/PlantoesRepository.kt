package br.com.alocca.plantoes

import org.json.JSONArray
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/** Dados usados pela tela, independentes do formato JSON do servidor. */
internal data class ItemPlantao(
    val id: String,
    val titulo: String = "",
    val instituicao: String = "",
    val especialidade: String = "",
    val local: String = "",
    val inicio: String = "",
    val fim: String = "",
    val valor: String? = null,
    val status: String = "",
    val medico: String = "",
    val crm: String = "",
    val mensagem: String = "",
)

internal sealed interface Resultado<out T> {
    data class Sucesso<T>(val valor: T) : Resultado<T>
    data class Erro(val mensagem: String) : Resultado<Nothing>
}

internal interface PlantoesRepository {
    suspend fun feed(pagina: Int): Resultado<List<ItemPlantao>>
    suspend fun minhasCandidaturas(pagina: Int): Resultado<List<ItemPlantao>>
    suspend fun plantoesGestor(): Resultado<List<ItemPlantao>>
    suspend fun candidatos(plantaoId: String): Resultado<List<ItemPlantao>>
    suspend fun candidatar(plantaoId: String, mensagem: String): Resultado<Unit>
    suspend fun aprovar(plantaoId: String, candidaturaId: String): Resultado<Unit>
}

internal fun interface PlantoesTransport {
    suspend fun request(path: String, body: JSONObject?): Resultado<String>
}

internal class HttpPlantoesRepository(
    private val transport: PlantoesTransport,
) : PlantoesRepository {
    constructor(token: String) : this(UrlConnectionPlantoesTransport(token))
    override suspend fun feed(pagina: Int) = listar("plantoes?limit=20&offset=${pagina * 20}")
    override suspend fun minhasCandidaturas(pagina: Int) = listar("candidaturas/medico?limit=20&offset=${pagina * 20}")
    override suspend fun plantoesGestor() = listar("plantoes/gestor")
    override suspend fun candidatos(plantaoId: String) = listar("plantoes/$plantaoId/candidaturas")
    override suspend fun candidatar(plantaoId: String, mensagem: String) = enviar(
        "plantoes/$plantaoId/candidaturas", JSONObject().apply {
            if (mensagem.isNotBlank()) put("mensagem", mensagem.trim())
        },
    )
    override suspend fun aprovar(plantaoId: String, candidaturaId: String) =
        enviar("plantoes/$plantaoId/candidaturas/$candidaturaId/aprovar", JSONObject())

    private suspend fun listar(path: String): Resultado<List<ItemPlantao>> = when (val result = transport.request(path, null)) {
        is Resultado.Erro -> result
        is Resultado.Sucesso -> try {
            val array = JSONArray(result.valor)
            Resultado.Sucesso((0 until array.length()).map { parseItem(array.getJSONObject(it)) })
        } catch (cancelled: CancellationException) {
            throw cancelled
        } catch (_: Exception) {
            Resultado.Erro("O servidor retornou uma resposta inválida. Tente novamente.")
        }
    }

    private suspend fun enviar(path: String, body: JSONObject): Resultado<Unit> = when (val result = transport.request(path, body)) {
        is Resultado.Erro -> result
        is Resultado.Sucesso -> Resultado.Sucesso(Unit)
    }

}

internal class UrlConnectionPlantoesTransport(private val token: String) : PlantoesTransport {
    override suspend fun request(path: String, body: JSONObject?): Resultado<String> = withContext(Dispatchers.IO) {
        var conexao: HttpURLConnection? = null
        try {
            conexao = URL(BuildConfig.API_BASE_URL + path).openConnection() as HttpURLConnection
            conexao.requestMethod = if (body == null) "GET" else "POST"
            conexao.connectTimeout = 10_000
            conexao.readTimeout = 15_000
            conexao.setRequestProperty("Authorization", "Bearer $token")
            if (body != null) {
                conexao.doOutput = true
                conexao.setRequestProperty("Content-Type", "application/json; charset=utf-8")
                conexao.outputStream.use { it.write(body.toString().toByteArray(Charsets.UTF_8)) }
            }
            val status = conexao.responseCode
            val texto = (if (status in 200..299) conexao.inputStream else conexao.errorStream)
                ?.bufferedReader(Charsets.UTF_8)?.use { it.readText() }.orEmpty()
            if (status in 200..299) Resultado.Sucesso(texto) else Resultado.Erro(
                runCatching { JSONObject(texto).optString("message") }.getOrNull()
                    ?.takeIf { it.isNotBlank() } ?: "Não foi possível concluir a operação (HTTP $status).",
            )
        } catch (cancelled: CancellationException) {
            throw cancelled
        } catch (_: Exception) {
            Resultado.Erro("Não foi possível carregar os dados. Verifique sua conexão e tente novamente.")
        } finally {
            conexao?.disconnect()
        }
    }
}

private fun JSONObject.texto(chave: String): String =
    if (isNull(chave)) "" else optString(chave).trim()

private fun parseItem(item: JSONObject): ItemPlantao {
    val plantao = item.optJSONObject("plantao") ?: item
    val instituicao = item.optJSONObject("instituicao")?.texto("nome") ?: item.texto("instituicao")
    val medico = item.optJSONObject("medico")
    return ItemPlantao(
        id = item.texto("id").also { require(it.isNotBlank()) { "ID ausente" } }, titulo = plantao.texto("titulo"), instituicao = instituicao,
        especialidade = plantao.texto("especialidade"), local = plantao.texto("local_unidade"),
        inicio = plantao.texto("data_inicio"), fim = plantao.texto("data_fim"),
        valor = plantao.texto("valor").takeIf { it.isNotEmpty() }, status = item.texto("status"),
        medico = medico?.texto("nome").orEmpty(), crm = medico?.texto("crm").orEmpty(),
        mensagem = item.texto("mensagem_medico"),
    )
}
