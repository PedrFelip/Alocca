package br.com.alocca.plantoes

import org.json.JSONArray
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

// plantao que da pra fazer check-in ou check-out agora (GET /presenca/proximos)
internal data class PlantaoProximo(
    val alocacaoId: String,
    val titulo: String,
    val especialidade: String,
    val localUnidade: String,
    val dataInicio: String,
    val dataFim: String,
    val instituicao: String,
    val cidadeUf: String,
    val checkinFeito: Boolean,
    val podeFazerCheckin: Boolean,
    val podeFazerCheckout: Boolean,
)

// o que a tela recebe de volta de qualquer chamada
internal data class RespostaPresenca(
    val ok: Boolean,
    val mensagem: String,
    val plantoes: List<PlantaoProximo> = emptyList(),
    // 401/403: o app limpa o token e volta pro login (contrato-auth-app.md)
    val sessaoExpirada: Boolean = false,
)

internal object PresencaApi {
    private const val SEM_CONEXAO = "Não foi possível conectar ao servidor. Verifique sua conexão."
    private const val ERRO_GENERICO = "Não foi possível concluir. Tente novamente."

    fun buscarProximos(token: String): RespostaPresenca {
        val (status, texto) = chamar("presenca/proximos", "GET", token, null)
            ?: return RespostaPresenca(false, SEM_CONEXAO)
        if (status !in 200..299) return erro(status, texto)

        // a resposta e uma lista, por isso JSONArray e nao JSONObject
        val plantoes = runCatching {
            val lista = JSONArray(texto)
            (0 until lista.length()).map { i ->
                val item = lista.getJSONObject(i)
                val plantao = item.getJSONObject("plantao")
                val inst = item.getJSONObject("instituicao")
                PlantaoProximo(
                    alocacaoId = item.getString("alocacao_id"),
                    titulo = campo(plantao, "titulo"),
                    especialidade = campo(plantao, "especialidade"),
                    localUnidade = campo(plantao, "local_unidade"),
                    dataInicio = campo(plantao, "data_inicio"),
                    dataFim = campo(plantao, "data_fim"),
                    instituicao = campo(inst, "nome"),
                    cidadeUf = listOf(campo(inst, "cidade"), campo(inst, "uf"))
                        .filter { it.isNotBlank() }.joinToString(" - "),
                    checkinFeito = item.optBoolean("checkin_feito"),
                    podeFazerCheckin = item.optBoolean("pode_fazer_checkin"),
                    podeFazerCheckout = item.optBoolean("pode_fazer_checkout"),
                )
            }
        }.getOrNull() ?: return RespostaPresenca(false, ERRO_GENERICO)

        return RespostaPresenca(true, "", plantoes)
    }

    // tipo e "ENTRADA" (check-in) ou "SAIDA" (check-out)
    // latitude e longitude vem null quando o gps foi negado (RN19)
    fun registrar(
        token: String,
        alocacaoId: String,
        tipo: String,
        latitude: Double?,
        longitude: Double?,
        precisao: Float?,
    ): RespostaPresenca {
        val corpo = JSONObject().put("alocacao_id", alocacaoId).put("tipo_evento", tipo)
        if (latitude != null && longitude != null) {
            corpo.put("latitude", latitude).put("longitude", longitude)
            if (precisao != null) corpo.put("precisao_metros", precisao.toDouble())
        }

        val (status, texto) = chamar("presenca", "POST", token, corpo)
            ?: return RespostaPresenca(false, SEM_CONEXAO)
        if (status !in 200..299) return erro(status, texto)

        // o back ja manda a mensagem pronta (MSG-11 ou MSG-12)
        val mensagem = runCatching { JSONObject(texto).optString("message") }.getOrNull().orEmpty()
        return RespostaPresenca(true, mensagem.ifBlank { "Registro feito." })
    }

    // devolve status e texto da resposta, ou null se nem conectou
    private fun chamar(caminho: String, metodo: String, token: String, corpo: JSONObject?): Pair<Int, String>? {
        var conexao: HttpURLConnection? = null
        return try {
            conexao = (URL(BuildConfig.API_BASE_URL + caminho).openConnection() as HttpURLConnection).apply {
                requestMethod = metodo
                connectTimeout = 10_000
                readTimeout = 15_000
                setRequestProperty("Authorization", "Bearer $token")
                if (corpo != null) {
                    doOutput = true
                    setRequestProperty("Content-Type", "application/json; charset=utf-8")
                }
            }
            if (corpo != null) {
                conexao.outputStream.use { it.write(corpo.toString().toByteArray(Charsets.UTF_8)) }
            }
            val status = conexao.responseCode
            val texto = (if (status in 200..299) conexao.inputStream else conexao.errorStream)
                ?.bufferedReader(Charsets.UTF_8)?.use { it.readText() }.orEmpty()
            status to texto
        } catch (_: Exception) {
            null
        } finally {
            conexao?.disconnect()
        }
    }

    // 404 e 409 usam a mensagem do back ("Você já fez o check-in deste plantão" etc)
    private fun erro(status: Int, texto: String): RespostaPresenca = when (status) {
        401, 403 -> RespostaPresenca(false, "", sessaoExpirada = true)
        404, 409 -> RespostaPresenca(
            false,
            runCatching { JSONObject(texto).optString("message") }.getOrNull()
                ?.takeIf { it.isNotBlank() } ?: ERRO_GENERICO,
        )
        else -> RespostaPresenca(false, ERRO_GENERICO)
    }

    // campo que pode vir null do banco vira texto vazio
    private fun campo(obj: JSONObject, nome: String): String =
        if (obj.isNull(nome)) "" else obj.optString(nome)
}
