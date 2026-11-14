package br.com.alocca.plantoes

import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

/**
 * Contrato `backend/docs/notificacoes.md`: endpoints autenticados, servidor
 * deriva o usuário do token — o cliente nunca envia `usuario_id`.
 * O corpo da caixa de entrada não define título/texto; a tela humaniza o
 * `tipo` recebido sem inventar conteúdo.
 */
internal data class NotificacaoInbox(
    val id: String,
    val tipo: String,
    val plantaoId: String?,
    val criadaEm: String,
    val lidaEm: String?,
) {
    /** `lida_at` ausente ou nulo significa não lida (o backend é a fonte da verdade). */
    val naoLida: Boolean get() = lidaEm == null
}

/** Página do inbox: `next_cursor` nulo ou vazio significa fim da lista. */
internal data class PaginaNotificacoes(
    val itens: List<NotificacaoInbox>,
    val nextCursor: String?,
    /** Contagem de não lidas calculada pelo servidor; nulo se ausente na resposta. */
    val naoLidas: Int?,
)

internal data class PreferenciasNotificacao(val push: Boolean, val email: Boolean)

// Mensagens compartilhadas (top-level: constantes de companion de superclasse
// não são acessíveis pelo nome do objeto que herda).
internal const val NOTIFICACAO_MSG_SESSAO_EXPIRADA = "Sua sessão expirou. Entre novamente."
internal const val NOTIFICACAO_MSG_FALHA_GENERICA = "Não foi possível concluir a operação. Tente novamente."

internal const val NOTIFICACOES_POR_PAGINA = 20

/** Conta não lidas a partir da lista já parseada (fallback quando o servidor não envia `nao_lidas`). */
internal fun contarNaoLidas(notificacoes: List<NotificacaoInbox>): Int =
    notificacoes.count { it.naoLida }

internal fun parseNotificacoes(texto: String): PaginaNotificacoes {
    val raiz = JSONObject(texto)
    val itens = (raiz.optJSONArray("items") ?: org.json.JSONArray()).let { lista ->
        (0 until lista.length()).mapNotNull { indice ->
            val item = lista.optJSONObject(indice) ?: return@mapNotNull null
            val id = item.optString("id").trim()
            if (id.isEmpty()) return@mapNotNull null
            NotificacaoInbox(
                id = id,
                tipo = item.optString("tipo").trim(),
                plantaoId = item.stringOrNull("plantao_id"),
                criadaEm = item.optString("created_at").trim(),
                lidaEm = item.stringOrNull("lida_at"),
            )
        }
    }
    // Cursor é UUID no contrato; qualquer valor estranho é tratado como fim.
    val cursor = raiz.stringOrNull("next_cursor")?.takeIf { DeepLink.validar(it) != null }
    val naoLidas = if (raiz.isNull("nao_lidas")) null else raiz.optInt("nao_lidas", -1).takeIf { it >= 0 }
    return PaginaNotificacoes(itens, cursor, naoLidas)
}

internal fun parsePreferencias(texto: String): PreferenciasNotificacao {
    val raiz = JSONObject(texto)
    // Sem a chave, assume desativado: o PUT seguinte escreve o valor real.
    return PreferenciasNotificacao(
        push = raiz.optBoolean("push", false),
        email = raiz.optBoolean("email", false),
    )
}

private fun JSONObject.stringOrNull(nome: String): String? {
    if (isNull(nome)) return null
    return optString(nome).trim().takeIf(String::isNotBlank)
}

/**
 * API do inbox autenticado e de preferências por canal.
 * `NotificacoesApi` usa a base do BuildConfig; a classe aberta aceita outra
 * base para testes com servidor local (mesmo padrão de FinanceiroCliente).
 */
internal object NotificacoesApi : NotificacoesCliente(BuildConfig.API_BASE_URL)

internal open class NotificacoesCliente(private val baseUrl: String) {
    companion object {
        const val MSG_RESPOSTA_INVALIDA = "O servidor retornou uma resposta inválida. Tente novamente."
    }

    /**
     * Lista mais recentes primeiro. `cursor` (UUID da página anterior) é
     * validado antes de entrar na URL — nada cru passa como path.
     * `somenteNaoLidas` e `limite` (worker usa 100) pelo contrato do polling.
     */
    fun listar(
        token: String,
        cursor: String? = null,
        somenteNaoLidas: Boolean = false,
        limite: Int = NOTIFICACOES_POR_PAGINA,
    ): Resposta<PaginaNotificacoes> {
        val caminho = buildString {
            append("notificacoes?limite=${limite.coerceIn(1, 100)}")
            DeepLink.validar(cursor)?.let { append("&cursor=$it") }
            if (somenteNaoLidas) append("&somente_nao_lidas=true")
        }
        return pedir(caminho, "GET", null, token) { parseNotificacoes(it) }
    }

    fun plantao(token: String, id: String): Resposta<org.json.JSONObject> {
        val valido = DeepLink.validar(id) ?: return Resposta.Falha("Plantão inválido", 400)
        return pedir("notificacoes/plantoes/$valido", "GET", null, token) { JSONObject(it) }
    }

    /** Idempotente no servidor: reler uma notificação já lida segue 2xx. */
    fun marcarLida(token: String, id: String): Resposta<Unit> =
        pedir("notificacoes/$id/lida", "PATCH", null, token) { }

    fun preferencias(token: String): Resposta<PreferenciasNotificacao> =
        pedir("notificacoes/preferencias", "GET", null, token) { parsePreferencias(it) }

    fun salvarPreferencias(token: String, preferencias: PreferenciasNotificacao): Resposta<Unit> =
        pedir(
            "notificacoes/preferencias", "PUT",
            JSONObject().put("push", preferencias.push).put("email", preferencias.email),
            token,
        ) { }

    private fun <T> pedir(
        path: String,
        metodo: String,
        payload: JSONObject?,
        token: String,
        converter: (String) -> T,
    ): Resposta<T> {
        var conexao: HttpURLConnection? = null
        return try {
            conexao = (URL(baseUrl + path).openConnection() as HttpURLConnection).apply {
                requestMethod = metodo
                connectTimeout = 10_000
                readTimeout = 15_000
                setRequestProperty("Authorization", "Bearer $token")
                if (payload != null) {
                    doOutput = true
                    setRequestProperty("Content-Type", "application/json; charset=utf-8")
                }
            }
            if (payload != null) {
                conexao.outputStream.use { it.write(payload.toString().toByteArray(Charsets.UTF_8)) }
            }
            val status = conexao.responseCode
            val texto = (if (status in 200..299) conexao.inputStream else conexao.errorStream)
                ?.bufferedReader(Charsets.UTF_8)?.use { it.readText() }.orEmpty()
            if (status !in 200..299) return Resposta.Falha(mensagemDeErro(status, texto), status)
            // Operações sem corpo (PATCH/PUT/DELETE) aceitam resposta vazia.
            if (texto.isBlank()) Resposta.Ok(converter("{}"))
            else runCatching { Resposta.Ok(converter(texto)) }
                .getOrElse { Resposta.Falha(MSG_RESPOSTA_INVALIDA, status) }
        } catch (_: Exception) {
            Resposta.Falha(ApiHttp.CONNECTION_ERROR, 0)
        } finally {
            conexao?.disconnect()
        }
    }

    private fun mensagemDeErro(status: Int, texto: String): String = when {
        status == 401 -> NOTIFICACAO_MSG_SESSAO_EXPIRADA
        status == 0 -> ApiHttp.CONNECTION_ERROR
        else -> runCatching { JSONObject(texto).optString("message") }.getOrNull()
            ?.takeIf(String::isNotBlank) ?: NOTIFICACAO_MSG_FALHA_GENERICA
    }
}
