package br.com.alocca.plantoes

import org.json.JSONArray
import org.json.JSONObject
import java.text.SimpleDateFormat
import java.util.Locale
import java.util.TimeZone

/** Instituição administrada pelo gestor logado (UC10). */
internal data class InstituicaoVinculada(
    val id: String,
    val nome: String,
    val nomeFantasia: String?,
    val cnpj: String,
    val cidade: String?,
    val uf: String?,
)

/** Plantão de uma instituição administrada pelo gestor (GET /plantoes/gerenciados). */
internal data class PlantaoGerenciado(
    val id: String,
    val titulo: String,
    val especialidade: String,
    val localUnidade: String,
    val dataInicio: String,
    val dataFim: String,
    val valor: String,
    val quantidadeVagas: Int,
    val vagasDisponiveis: Int,
    val status: String,
    val instituicaoNome: String,
) {
    val vagasPreenchidas: Int get() = (quantidadeVagas - vagasDisponiveis).coerceAtLeast(0)
}

/** Pedidos do backend: paginação máxima de 50 itens (limite do próprio backend). */
internal const val PLANTOES_POR_PAGINA = 50

internal object PlantoesApi {
    private const val VINCULADAS_PATH = "instituicoes/vinculadas"
    private const val GERENCIADOS_PATH = "plantoes/gerenciados"
    private const val PUBLICAR_PATH = "plantoes"
    private const val INVALID_RESPONSE = "O servidor retornou uma resposta inválida. Tente novamente."
    private const val FALHA_GENERICA = "Não foi possível concluir. Tente novamente."
    const val MSG_SESSAO_EXPIRADA = "Sua sessão expirou. Faça login novamente."

    /** UC10 — Instituições disponíveis no formulário de publicação. */
    fun listarInstituicoesVinculadas(token: String): List<InstituicaoVinculada> {
        val resposta = ApiHttp.enviar(VINCULADAS_PATH, "GET", token = token)
        if (resposta.status == 0) throw ApiException(ApiHttp.CONNECTION_ERROR, 0)
        if (resposta.status !in 200..299) throw ApiException(mensagemDeErro(resposta), resposta.status)
        if (resposta.texto.isBlank()) throw ApiException(INVALID_RESPONSE, resposta.status)
        val array = runCatching { JSONArray(resposta.texto) }.getOrElse {
            throw ApiException(INVALID_RESPONSE, resposta.status)
        }
        val instituicoes = mutableListOf<InstituicaoVinculada>()
        for (i in 0 until array.length()) {
            val item = array.optJSONObject(i) ?: throw ApiException(INVALID_RESPONSE, resposta.status)
            val id = item.optString("id").trim()
            if (id.isEmpty()) throw ApiException(INVALID_RESPONSE, resposta.status)
            instituicoes += InstituicaoVinculada(
                id = id,
                nome = item.optString("nome").trim(),
                nomeFantasia = item.stringOrNull("nome_fantasia"),
                cnpj = item.optString("cnpj").trim(),
                cidade = item.stringOrNull("cidade"),
                uf = item.stringOrNull("uf"),
            )
        }
        return instituicoes
    }

    /**
     * UC10 — Uma página de plantões das instituições administradas pelo gestor.
     * `offset` + PLANTOES_POR_PAGINA para paginar; a lista completa volta por
     * páginas (a página final pode vir com menos itens que o limite).
     */
    fun listarPlantoesGerenciados(token: String, offset: Int = 0, status: String? = null): List<PlantaoGerenciado> {
        val resposta = ApiHttp.enviar(
            "$GERENCIADOS_PATH?limit=$PLANTOES_POR_PAGINA&offset=$offset" + (status?.let { "&status=$it" } ?: ""),
            "GET",
            token = token,
        )
        if (resposta.status == 0) throw ApiException(ApiHttp.CONNECTION_ERROR, 0)
        if (resposta.status !in 200..299) throw ApiException(mensagemDeErro(resposta), resposta.status)
        // Corpo vazio ou não-array é violação de contrato, não lista vazia.
        if (resposta.texto.isBlank()) throw ApiException(INVALID_RESPONSE, resposta.status)
        val array = runCatching { JSONArray(resposta.texto) }.getOrElse {
            throw ApiException(INVALID_RESPONSE, resposta.status)
        }
        val plantoes = mutableListOf<PlantaoGerenciado>()
        for (i in 0 until array.length()) {
            val item = array.optJSONObject(i) ?: throw ApiException(INVALID_RESPONSE, resposta.status)
            val id = item.optString("id").trim()
            val status = item.optString("status").trim()
            val dataInicio = item.optString("data_inicio").trim()
            val dataFim = item.optString("data_fim").trim()
            val valor = item.optString("valor").trim()
            val instituicao = item.optJSONObject("instituicao")
            // Campos essenciais do contrato; violação = resposta inválida.
            if (
                id.isEmpty() || status.isEmpty() ||
                dataInicio.isEmpty() || dataFim.isEmpty() || valor.isEmpty() ||
                instituicao == null || instituicao.optString("nome").trim().isEmpty() ||
                !item.has("quantidade_vagas") || !item.has("vagas_disponiveis") ||
                item.optInt("quantidade_vagas") < 1 ||
                item.optInt("vagas_disponiveis") < 0 ||
                item.optInt("vagas_disponiveis") > item.optInt("quantidade_vagas")
            ) {
                throw ApiException(INVALID_RESPONSE, resposta.status)
            }
            plantoes += PlantaoGerenciado(
                id = id,
                titulo = item.optString("titulo").trim(),
                especialidade = item.optString("especialidade").trim(),
                localUnidade = item.optString("local_unidade").trim(),
                dataInicio = dataInicio,
                dataFim = item.optString("data_fim").trim(),
                valor = item.optString("valor").trim(),
                quantidadeVagas = item.optInt("quantidade_vagas"),
                vagasDisponiveis = item.optInt("vagas_disponiveis"),
                status = status,
                instituicaoNome = instituicao.optString("nome").trim().ifBlank { "Instituição" },
            )
        }
        return plantoes
    }

    /** UC10 — Publica o plantão; o sucesso confirma com MSG-14 do servidor. */
    fun publicarPlantao(token: String, payload: JSONObject): String {
        val resposta = ApiHttp.enviar(PUBLICAR_PATH, "POST", payload = payload, token = token)
        if (resposta.status == 0) throw ApiException(ApiHttp.CONNECTION_ERROR, 0)
        if (resposta.status !in 200..299) throw ApiException(mensagemDeErro(resposta), resposta.status)
        val body = runCatching { JSONObject(resposta.texto) }.getOrNull()
            ?: throw ApiException(INVALID_RESPONSE, resposta.status)
        val plantao = body.optJSONObject("plantao")
        if (plantao == null || plantao.optString("id").isBlank()) {
            throw ApiException(INVALID_RESPONSE, resposta.status)
        }
        return body.optString("message").trim()
    }

    /**
     * Converte os campos do formulário (dd/MM/aaaa + HH:mm) no formato ISO
     * (UTC) aceito pelo backend. Retorna null quando algo não for válido.
     */
    fun paraIso(data: String, hora: String): String? {
        val dataLimpa = data.trim()
        val horaLimpa = hora.trim()
        if (!Regex("""\d{2}/\d{2}/\d{4}""").matches(dataLimpa)) return null
        if (!Regex("""\d{2}:\d{2}""").matches(horaLimpa)) return null
        val entrada = SimpleDateFormat("dd/MM/yyyy HH:mm", Locale.getDefault()).apply {
            isLenient = false
        }
        val saida = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US).apply {
            timeZone = TimeZone.getTimeZone("UTC")
        }
        return try {
            val momento = entrada.parse("$dataLimpa $horaLimpa") ?: return null
            saida.format(momento)
        } catch (_: Exception) {
            null
        }
    }

    /**
     * Timestamps ISO do backend (UTC) → horário local do aparelho.
     * O parser precisa consumir a data completa, incluindo milissegundos e o
     * sufixo "Z", para não tratar 10:00Z como hora local.
     */
    private fun parseIso(iso: String): java.util.Date? {
        val valor = iso.trim()
        if (valor.isEmpty()) return null
        val comUtc = valor.endsWith("Z") || valor.endsWith("z") ||
            Regex("[+-]\\d{2}:?\\d{2}$").containsMatchIn(valor)
        val padroes = listOf(
            "yyyy-MM-dd'T'HH:mm:ss.SSSXXX",
            "yyyy-MM-dd'T'HH:mm:ss.SSS'Z'",
            "yyyy-MM-dd'T'HH:mm:ssXXX",
            "yyyy-MM-dd'T'HH:mm:ss'Z'",
            "yyyy-MM-dd'T'HH:mm:ss.SSS",
            "yyyy-MM-dd'T'HH:mm:ss",
        )
        for (padrao in padroes) {
            val parser = SimpleDateFormat(padrao, Locale.US).apply {
                isLenient = false
                timeZone = if (comUtc) TimeZone.getTimeZone("UTC") else TimeZone.getDefault()
            }
            val posicao = java.text.ParsePosition(0)
            // Exige consumo integral do texto: SDF pode aceitar só o prefixo e
            // descartar o offset/milissegundos sem este check.
            val resultado = parser.parse(valor, posicao) ?: continue
            if (posicao.index != valor.length) continue
            return resultado
        }
        return null
    }

    /** "2026-11-20T10:00:00.000Z" → "20/11/2026 • 07:00" (horário local). */
    fun formatarDataHora(iso: String): String {
        val momento = parseIso(iso) ?: return iso
        val saida = SimpleDateFormat("dd/MM/yyyy • HH:mm", Locale.getDefault())
        return saida.format(momento)
    }

    /** Apenas a hora local ("HH:mm") de um timestamp ISO do backend. */
    fun formatarHora(iso: String): String {
        val momento = parseIso(iso) ?: return iso
        val saida = SimpleDateFormat("HH:mm", Locale.getDefault())
        return saida.format(momento)
    }

    /** Datas do card (dia, mês abreviado, "Sex. 19:30") no fuso local. */
    fun dataDoCard(iso: String): Triple<String, String, String> {
        val momento = parseIso(iso) ?: return Triple(iso.take(2), "", iso)
        val calendario = java.util.Calendar.getInstance().apply { time = momento }
        val dia = String.format(Locale.getDefault(), "%02d", calendario.get(java.util.Calendar.DAY_OF_MONTH))
        val mes = SimpleDateFormat("MMM", Locale("pt", "BR"))
            .format(momento).uppercase(Locale("pt", "BR")).removeSuffix(".")
        val diaSemana = SimpleDateFormat("EEE", Locale("pt", "BR")).format(momento)
            .removeSuffix(".")
            .replaceFirstChar { it.uppercase(Locale("pt", "BR")) }
        val hora = SimpleDateFormat("HH:mm", Locale.getDefault()).format(momento)
        return Triple(dia, mes, "$diaSemana. $hora")
    }

    /** "1800.00" → "R$ 1800,00" (o backend envia numeric como texto). */
    fun formatarValor(valor: String): String {
        val numero = valor.trim().replace(',', '.').toDoubleOrNull() ?: return "R$ $valor"
        val texto = String.format(Locale("pt", "BR"), "%.2f", numero)
        return "R$ $texto"
    }

    private fun mensagemDeErro(resposta: ApiHttp.Resposta): String =
        resposta.texto.takeIf(String::isNotBlank)
            ?.let { runCatching { JSONObject(it) }.getOrNull() }
            ?.optString("message")
            ?.takeIf(String::isNotBlank)
            ?: when (resposta.status) {
                401 -> MSG_SESSAO_EXPIRADA
                else -> FALHA_GENERICA
            }
}

internal class ApiException(
    val userMessage: String,
    val status: Int,
) : Exception(userMessage)

private fun JSONObject.stringOrNull(name: String): String? {
    // JSONObject.optString devolve "null" para valores JSON null em versões do Android.
    if (isNull(name)) return null
    return optString(name).trim().takeIf(String::isNotBlank)
}
