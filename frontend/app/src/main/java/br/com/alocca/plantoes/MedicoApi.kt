package br.com.alocca.plantoes

import org.json.JSONArray
import org.json.JSONObject
import java.math.BigDecimal
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder
import java.text.NumberFormat
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone

/** Resultado de uma chamada à API: dados prontos para a tela ou mensagem de erro. */
internal sealed interface Resposta<out T> {
    data class Ok<T>(val dados: T) : Resposta<T>
    data class Falha(val mensagem: String, val status: Int) : Resposta<Nothing> {
        /** Token ausente, expirado ou revogado: a tela deve encerrar a sessão. */
        val sessaoExpirada: Boolean get() = status == 401
    }
}

// ---------------------------------------------------------------------------
// Modelos (somente o que as telas do médico usam).
// ---------------------------------------------------------------------------

internal data class InstituicaoResumo(val nome: String, val cidade: String?, val uf: String?) {
    val local: String get() = listOfNotNull(cidade, uf).joinToString(" - ")
}

internal data class PlantaoResumo(
    val id: String,
    val titulo: String,
    val especialidade: String,
    val localUnidade: String?,
    val inicio: Date,
    val fim: Date,
    val valor: BigDecimal,
    val instituicao: InstituicaoResumo,
    val vagasDisponiveis: Int? = null,
    val quantidadeVagas: Int? = null,
    val descricao: String? = null,
)

internal data class Candidatura(val id: String, val status: String, val criadaEm: Date?, val plantao: PlantaoResumo)

internal data class ItemAgenda(val id: String, val status: String, val tipoOrigem: String, val plantao: PlantaoResumo)

internal data class DiaAgenda(val dia: String, val itens: List<ItemAgenda>)

internal data class Pagamento(
    val id: String,
    val valor: BigDecimal,
    val status: String,
    val vencimentoEm: Date?,
    val pagoEm: Date?,
    val plantaoTitulo: String,
    val plantaoInicio: Date,
    val instituicao: InstituicaoResumo,
)

internal data class Financeiro(
    val totalRecebido: BigDecimal,
    val totalAReceber: BigDecimal,
    val totalPendente: BigDecimal,
    val pagamentos: List<Pagamento>,
)

internal data class PresencaProxima(
    val alocacaoId: String,
    val checkinFeito: Boolean,
    val podeFazerCheckin: Boolean,
    val podeFazerCheckout: Boolean,
    val checkinLiberadoEm: Date?,
    val checkoutAte: Date?,
    val plantao: PlantaoResumo,
)

internal data class RegistroPonto(
    val id: String,
    val tipoEvento: String,
    val timestamp: Date,
    val comLocalizacao: Boolean,
    val alocacaoId: String,
    val plantaoTitulo: String,
    val instituicao: InstituicaoResumo,
)

internal data class PerfilCompleto(
    val nome: String,
    val email: String,
    val cpf: String?,
    val telefone: String?,
    val crm: String?,
    val ufCrm: String?,
    val especialidade: String?,
    val statusValidacao: String?,
    val motivoRejeicao: String?,
)

internal data class FiltrosFeed(
    val especialidade: String = "",
    val cidade: String = "",
    val uf: String = "",
    val valorMin: String = "",
    val valorMax: String = "",
) {
    val ativos: Int
        get() = listOf(especialidade, cidade, uf, valorMin, valorMax).count { it.isNotBlank() }
}

// ---------------------------------------------------------------------------
// Chamadas. Todas são bloqueantes: chame fora da main thread.
// ---------------------------------------------------------------------------

internal object MedicoApi {
    const val TAMANHO_PAGINA = 20

    fun feed(token: String, filtros: FiltrosFeed, offset: Int): Resposta<List<PlantaoResumo>> {
        val query = buildList {
            add("limit" to TAMANHO_PAGINA.toString())
            add("offset" to offset.toString())
            if (filtros.especialidade.isNotBlank()) add("especialidade" to filtros.especialidade.trim())
            if (filtros.cidade.isNotBlank()) add("cidade" to filtros.cidade.trim())
            if (filtros.uf.isNotBlank()) add("uf" to filtros.uf.trim().uppercase())
            if (filtros.valorMin.isNotBlank()) add("valor_min" to filtros.valorMin.trim().replace(',', '.'))
            if (filtros.valorMax.isNotBlank()) add("valor_max" to filtros.valorMax.trim().replace(',', '.'))
        }
        return ApiHttp.get("plantoes" + queryString(query), token).lista { it.plantao() }
    }

    fun candidatar(token: String, plantaoId: String): Resposta<String> =
        when (val r = ApiHttp.send("POST", "plantoes/$plantaoId/candidaturas", token, JSONObject())) {
            is Resposta.Ok -> Resposta.Ok((r.dados as? JSONObject)?.optString("message").orEmpty()
                .ifBlank { "Candidatura enviada com sucesso." })
            is Resposta.Falha -> r
        }

    fun minhasCandidaturas(token: String): Resposta<List<Candidatura>> =
        ApiHttp.get("candidaturas/medico?limit=50", token).lista { json ->
            Candidatura(
                id = json.getString("id"),
                status = json.getString("status"),
                criadaEm = json.data("criada_em"),
                plantao = json.getJSONObject("plantao").plantao(json.optJSONObject("instituicao")),
            )
        }

    fun agendaMes(token: String, ano: Int, mes: Int): Resposta<List<DiaAgenda>> =
        ApiHttp.get("agenda/mes?ano=$ano&mes=$mes", token).lista { dia ->
            val itens = dia.getJSONArray("itens")
            DiaAgenda(
                dia = dia.getString("dia"),
                itens = List(itens.length()) { i ->
                    val item = itens.getJSONObject(i)
                    ItemAgenda(
                        id = item.getString("id"),
                        status = item.getString("status"),
                        tipoOrigem = item.optString("tipo_origem"),
                        plantao = item.getJSONObject("plantao").plantao(item.optJSONObject("instituicao")),
                    )
                },
            )
        }

    fun financeiro(token: String): Resposta<Financeiro> =
        ApiHttp.get("financeiro/medico", token).objeto { json ->
            val resumo = json.getJSONObject("resumo")
            val pagamentos = json.getJSONArray("pagamentos")
            Financeiro(
                totalRecebido = BigDecimal(resumo.getString("total_recebido")),
                totalAReceber = BigDecimal(resumo.getString("total_a_receber")),
                totalPendente = BigDecimal(resumo.getString("total_pendente")),
                pagamentos = List(pagamentos.length()) { i ->
                    val p = pagamentos.getJSONObject(i)
                    val plantao = p.getJSONObject("plantao")
                    Pagamento(
                        id = p.getString("id"),
                        valor = BigDecimal(p.getString("valor")),
                        status = p.getString("status"),
                        vencimentoEm = p.data("vencimento_em"),
                        pagoEm = p.data("pago_at"),
                        plantaoTitulo = plantao.getString("titulo"),
                        plantaoInicio = plantao.data("data_inicio") ?: Date(0),
                        instituicao = p.optJSONObject("instituicao").instituicao(),
                    )
                },
            )
        }

    fun proximos(token: String): Resposta<List<PresencaProxima>> =
        ApiHttp.get("presenca/proximos", token).lista { json ->
            PresencaProxima(
                alocacaoId = json.getString("alocacao_id"),
                checkinFeito = json.optBoolean("checkin_feito"),
                podeFazerCheckin = json.optBoolean("pode_fazer_checkin"),
                podeFazerCheckout = json.optBoolean("pode_fazer_checkout"),
                checkinLiberadoEm = json.data("checkin_liberado_em"),
                checkoutAte = json.data("checkout_ate"),
                plantao = json.getJSONObject("plantao").plantao(json.optJSONObject("instituicao")),
            )
        }

    /** Registra entrada/saída. Coordenadas nulas = sem localização (RN19). */
    fun registrarPresenca(
        token: String,
        alocacaoId: String,
        tipoEvento: String,
        latitude: Double?,
        longitude: Double?,
        precisaoMetros: Double?,
    ): Resposta<String> {
        val corpo = JSONObject()
            .put("alocacao_id", alocacaoId)
            .put("tipo_evento", tipoEvento)
            .put("latitude", latitude ?: JSONObject.NULL)
            .put("longitude", longitude ?: JSONObject.NULL)
            .put("precisao_metros", precisaoMetros ?: JSONObject.NULL)
        return when (val r = ApiHttp.send("POST", "presenca", token, corpo)) {
            is Resposta.Ok -> Resposta.Ok((r.dados as? JSONObject)?.optString("message").orEmpty()
                .ifBlank { "Registro realizado com sucesso." })
            is Resposta.Falha -> r
        }
    }

    fun historico(token: String, limit: Int = 30): Resposta<List<RegistroPonto>> =
        ApiHttp.get("presenca/historico?limit=$limit", token).lista { json ->
            RegistroPonto(
                id = json.getString("id"),
                tipoEvento = json.getString("tipo_evento"),
                timestamp = json.data("timestamp_servidor") ?: Date(0),
                comLocalizacao = json.optBoolean("com_localizacao"),
                alocacaoId = json.getString("alocacao_id"),
                plantaoTitulo = json.getJSONObject("plantao").getString("titulo"),
                instituicao = json.optJSONObject("instituicao").instituicao(),
            )
        }

    fun perfil(token: String): Resposta<PerfilCompleto> =
        ApiHttp.get("usuarios/me", token).objeto { it.perfilCompleto() }

    /** PATCH /usuarios/me com os campos alterados; devolve o perfil recarregado. */
    fun atualizarPerfil(token: String, campos: JSONObject): Resposta<PerfilCompleto> =
        when (val r = ApiHttp.send("PATCH", "usuarios/me", token, campos)) {
            is Resposta.Ok -> perfil(token)
            is Resposta.Falha -> r
        }

    private fun queryString(pares: List<Pair<String, String>>): String =
        if (pares.isEmpty()) "" else pares.joinToString("&", prefix = "?") { (k, v) ->
            "$k=${URLEncoder.encode(v, "UTF-8")}"
        }
}

// ---------------------------------------------------------------------------
// HTTP e parsing.
// ---------------------------------------------------------------------------

private object ApiHttp {
    private const val CONEXAO =
        "Não foi possível conectar ao servidor. Verifique sua conexão e a URL do backend."
    private const val SESSAO_EXPIRADA = "Sua sessão expirou. Entre novamente."
    private const val RESPOSTA_INVALIDA = "O servidor retornou uma resposta inválida. Tente novamente."
    private const val FALHA_GENERICA = "Não foi possível concluir. Tente novamente."

    fun get(path: String, token: String): Resposta<Any?> = send("GET", path, token, null)

    fun send(method: String, path: String, token: String, corpo: JSONObject?): Resposta<Any?> {
        var conexao: HttpURLConnection? = null
        return try {
            conexao = (URL(BuildConfig.API_BASE_URL + path).openConnection() as HttpURLConnection).apply {
                requestMethod = method
                connectTimeout = 10_000
                readTimeout = 15_000
                setRequestProperty("Authorization", "Bearer $token")
                setRequestProperty("Accept", "application/json")
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
            val json: Any? = texto.trim().let { t ->
                when {
                    t.startsWith("[") -> runCatching { JSONArray(t) }.getOrNull()
                    t.startsWith("{") -> runCatching { JSONObject(t) }.getOrNull()
                    else -> null
                }
            }
            if (status in 200..299) Resposta.Ok(json) else Resposta.Falha(mensagemDeErro(status, json), status)
        } catch (_: Exception) {
            Resposta.Falha(CONEXAO, 0)
        } finally {
            conexao?.disconnect()
        }
    }

    /** Usa a mensagem do servidor (catálogo MSG-XX) sempre que ela existir. */
    private fun mensagemDeErro(status: Int, json: Any?): String {
        if (status == 401) return SESSAO_EXPIRADA
        val message = (json as? JSONObject)?.opt("message")
        val texto = when (message) {
            is String -> message
            is JSONArray -> (0 until message.length()).joinToString("\n") { message.optString(it) }
            else -> null
        }
        return texto?.takeIf(String::isNotBlank) ?: FALHA_GENERICA
    }

    fun invalida(status: Int = 0) = Resposta.Falha(RESPOSTA_INVALIDA, status)
}

private fun <T> Resposta<Any?>.lista(mapear: (JSONObject) -> T): Resposta<List<T>> = when (this) {
    is Resposta.Falha -> this
    is Resposta.Ok -> {
        val array = dados as? JSONArray
        if (array == null) ApiHttp.invalida()
        else runCatching { List(array.length()) { mapear(array.getJSONObject(it)) } }
            .fold({ Resposta.Ok(it) }, { ApiHttp.invalida() })
    }
}

private fun <T> Resposta<Any?>.objeto(mapear: (JSONObject) -> T): Resposta<T> = when (this) {
    is Resposta.Falha -> this
    is Resposta.Ok -> {
        val json = dados as? JSONObject
        if (json == null) ApiHttp.invalida()
        else runCatching { mapear(json) }.fold({ Resposta.Ok(it) }, { ApiHttp.invalida() })
    }
}

private fun JSONObject.texto(nome: String): String? =
    if (isNull(nome)) null else optString(nome).trim().takeIf(String::isNotBlank)

private fun JSONObject.data(nome: String): Date? = texto(nome)?.let(Datas::parseIso)

private fun JSONObject?.instituicao(): InstituicaoResumo = InstituicaoResumo(
    nome = this?.texto("nome_fantasia") ?: this?.texto("nome") ?: "Instituição",
    cidade = this?.texto("cidade"),
    uf = this?.texto("uf"),
)

/** Plantão do feed (instituição embutida) ou de outras rotas (instituição ao lado). */
private fun JSONObject.plantao(instituicao: JSONObject? = optJSONObject("instituicao")): PlantaoResumo =
    PlantaoResumo(
        id = getString("id"),
        titulo = getString("titulo"),
        especialidade = texto("especialidade") ?: "",
        localUnidade = texto("local_unidade"),
        inicio = data("data_inicio") ?: throw IllegalStateException("data_inicio"),
        fim = data("data_fim") ?: throw IllegalStateException("data_fim"),
        valor = texto("valor")?.let(::BigDecimal) ?: BigDecimal.ZERO,
        instituicao = instituicao.instituicao(),
        vagasDisponiveis = if (has("vagas_disponiveis")) optInt("vagas_disponiveis") else null,
        quantidadeVagas = if (has("quantidade_vagas")) optInt("quantidade_vagas") else null,
        descricao = texto("descricao"),
    )

private fun JSONObject.perfilCompleto(): PerfilCompleto {
    val medico = optJSONObject("medico")
    return PerfilCompleto(
        nome = getString("nome"),
        email = getString("email"),
        cpf = texto("cpf"),
        telefone = texto("telefone"),
        crm = medico?.texto("crm"),
        ufCrm = medico?.texto("uf_crm"),
        especialidade = medico?.texto("especialidade"),
        statusValidacao = medico?.texto("status_validacao"),
        motivoRejeicao = medico?.texto("motivo_rejeicao"),
    )
}

// ---------------------------------------------------------------------------
// Formatação: banco em UTC, apresentação em America/Sao_Paulo.
// ---------------------------------------------------------------------------

internal object Datas {
    private val brasil = Locale("pt", "BR")
    val fuso: TimeZone = TimeZone.getTimeZone("America/Sao_Paulo")

    private fun formato(padrao: String, tz: TimeZone = fuso) =
        SimpleDateFormat(padrao, brasil).apply { timeZone = tz }

    fun parseIso(texto: String): Date? = listOf(
        "yyyy-MM-dd'T'HH:mm:ss.SSSX",
        "yyyy-MM-dd'T'HH:mm:ssX",
    ).firstNotNullOfOrNull { padrao ->
        runCatching { formato(padrao, TimeZone.getTimeZone("UTC")).parse(texto) }.getOrNull()
    }

    fun dia(d: Date) = formato("dd").format(d)
    fun mesCurto(d: Date) = formato("MMM").format(d).trimEnd('.').uppercase(brasil)
    fun semanaCurta(d: Date) = formato("EEE").format(d).trimEnd('.').replaceFirstChar { it.titlecase(brasil) }
    fun hora(d: Date) = formato("HH:mm").format(d)
    fun dataCurta(d: Date) = formato("dd/MM/yyyy").format(d)
    fun dataHora(d: Date) = formato("dd/MM/yyyy 'às' HH:mm").format(d)
    fun diaPorExtenso(d: Date) = formato("EEEE, d 'de' MMMM").format(d).replaceFirstChar { it.titlecase(brasil) }
    fun chaveDia(d: Date) = formato("yyyy-MM-dd").format(d)

    fun horario(inicio: Date, fim: Date): String {
        val horas = ((fim.time - inicio.time) / 3_600_000.0)
        val duracao = if (horas % 1.0 == 0.0) "${horas.toInt()}h" else String.format(brasil, "%.1fh", horas)
        return "${hora(inicio)} - ${hora(fim)} ($duracao)"
    }

    fun moeda(valor: BigDecimal): String = NumberFormat.getCurrencyInstance(brasil).format(valor)
}
