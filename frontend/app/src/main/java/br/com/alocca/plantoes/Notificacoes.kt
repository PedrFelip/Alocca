package br.com.alocca.plantoes

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import java.net.URLEncoder
import kotlinx.coroutines.*
import org.json.JSONObject

internal data class Notificacao(
    val id: String,
    val tipo: String,
    val plantaoId: String,
    val titulo: String,
    val mensagem: String,
    val lidaEm: String?,
    val criadaEm: String,
)

internal data class PaginaNotificacoes(
    val dados: List<Notificacao>,
    val pagina: Int,
    val limite: Int,
    val total: Int,
    val ate: String? = null,
)

internal class NotificacoesApi(
    private val enviar: (String, String, JSONObject?, String) -> ApiHttp.Resposta = { p, m, b, t ->
        ApiHttp.enviar(p, m, b, t)
    }
) {
    private fun <T> request(
        path: String,
        method: String,
        token: String,
        body: JSONObject? = null,
        parse: (JSONObject) -> T,
    ): T {
        val r = enviar(path, method, body, token)
        if (r.status == 0) throw ApiException(ApiHttp.CONNECTION_ERROR, 0)
        if (r.status !in 200..299)
            throw ApiException(
                runCatching { JSONObject(r.texto).optString("message") }
                    .getOrNull()
                    ?.takeIf { it.isNotBlank() } ?: "Não foi possível concluir. Tente novamente.",
                r.status,
            )
        return try {
            parse(JSONObject(r.texto))
        } catch (_: Exception) {
            throw ApiException(
                "O servidor retornou uma resposta inválida. Tente novamente.",
                r.status,
            )
        }
    }

    fun listar(token: String, pagina: Int, ate: String? = null) =
        request(
            "notificacoes?pagina=$pagina&limite=20" +
                (ate?.let { "&ate=" + URLEncoder.encode(it, "UTF-8") } ?: ""),
            "GET",
            token,
        ) { j ->
            val a = j.getJSONArray("dados")
            val p = j.getInt("pagina")
            val l = j.getInt("limite")
            val t = j.getInt("total")
            require(p > 0 && l > 0 && t >= 0)
            PaginaNotificacoes(
                List(a.length()) { parse(a.getJSONObject(it)) },
                p,
                l,
                t,
                j.optString("ate").takeIf { it.isNotBlank() },
            )
        }

    fun ler(token: String, id: String) =
        request(
            "notificacoes/${URLEncoder.encode(id, "UTF-8").replace("+", "%20")}/lida",
            "PATCH",
            token,
        ) {
            parse(it)
        }

    fun preferencias(token: String) =
        request("notificacoes/preferencias", "GET", token) { it.getBoolean("email_habilitado") }

    fun salvar(token: String, valor: Boolean) =
        request(
            "notificacoes/preferencias",
            "PUT",
            token,
            JSONObject().put("email_habilitado", valor),
        ) {
            it.getBoolean("email_habilitado")
        }

    private fun parse(j: JSONObject) =
        Notificacao(
            j.getString("id"),
            j.getString("tipo"),
            j.getString("plantao_id"),
            j.getString("titulo"),
            j.getString("mensagem"),
            if (j.isNull("lida_em")) null else j.getString("lida_em"),
            j.getString("created_at"),
        )
}

@Composable
internal fun NotificationsPanel(token: String?, onSessaoExpirada: () -> Unit, onClose: () -> Unit) {
    val api = remember { NotificacoesApi() }
    val scope = rememberCoroutineScope()
    val expirar by rememberUpdatedState(onSessaoExpirada)
    var itens by remember(token) { mutableStateOf<List<Notificacao>>(emptyList()) }
    var pagina by remember(token) { mutableIntStateOf(0) }
    var total by remember(token) { mutableIntStateOf(0) }
    var snapshot by remember(token) { mutableStateOf<String?>(null) }
    var fim by remember(token) { mutableStateOf(false) }
    var carregando by remember(token) { mutableStateOf(false) }
    var erro by remember(token) { mutableStateOf("") }
    var tentativa by remember(token) { mutableIntStateOf(0) }
    var proxima by remember(token) { mutableIntStateOf(1) }
    var lendo by remember(token) { mutableStateOf<String?>(null) }
    var leituraPendente by remember(token) { mutableStateOf<String?>(null) }
    fun marcarLida(id: String) {
        scope.launch {
            lendo = id
            leituraPendente = null
            erro = ""
            try {
                val atualizada = withContext(Dispatchers.IO) { api.ler(token!!, id) }
                itens = itens.map { if (it.id == id) atualizada else it }
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                if (e is ApiException && e.status == 401) expirar()
                else {
                    leituraPendente = id
                    erro = (e as? ApiException)?.userMessage ?: "Não foi possível marcar como lida."
                }
            } finally {
                lendo = null
            }
        }
    }
    LaunchedEffect(token, tentativa) {
        if (token == null) {
            expirar()
            return@LaunchedEffect
        }
        carregando = true
        erro = ""
        leituraPendente = null
        try {
            val r =
                withContext(Dispatchers.IO) {
                    api.listar(token, proxima, if (proxima == 1) null else snapshot)
                }
            itens = if (proxima == 1) r.dados else (itens + r.dados).distinctBy { it.id }
            pagina = r.pagina
            total = r.total
            snapshot = r.ate
            fim = r.dados.size < r.limite
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            if (e is ApiException && e.status == 401) expirar()
            else
                erro =
                    (e as? ApiException)?.userMessage ?: "Não foi possível carregar notificações."
        } finally {
            carregando = false
        }
    }
    Surface(
        modifier = Modifier.width(320.dp).heightIn(max = 520.dp),
        shadowElevation = 10.dp,
        shape = RoundedCornerShape(16.dp),
        color = Color.White,
        border = BorderStroke(1.dp, Color(0xFFE0E5E5)),
    ) {
        Column(Modifier.padding(16.dp)) {
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                Text("Notificações", style = MaterialTheme.typography.titleMedium)
                TextButton(onClick = onClose) { Text("Fechar") }
            }
            Column(Modifier.weight(1f, fill = false).verticalScroll(rememberScrollState())) {
                TextButton(
                    enabled = !carregando && lendo == null,
                    onClick = {
                        proxima = 1
                        tentativa++
                    },
                ) {
                    Text("Atualizar")
                }
                itens.forEach { item ->
                    Column(
                        Modifier.fillMaxWidth()
                            .clickable(
                                enabled =
                                    item.lidaEm == null &&
                                        lendo == null &&
                                        !carregando &&
                                        token != null
                            ) {
                                marcarLida(item.id)
                            }
                            .padding(vertical = 10.dp)
                    ) {
                        Text(item.titulo, style = MaterialTheme.typography.titleSmall)
                        Text(item.mensagem, style = MaterialTheme.typography.bodyMedium)
                        val data =
                            Datas.parseIso(item.criadaEm)?.let { Datas.dataHora(it) }
                                ?: item.criadaEm
                        Text(
                            "$data • ${if (item.lidaEm == null) if (lendo == item.id) "Marcando como lida…" else "Não lida • Toque para marcar como lida" else "Lida"}",
                            style = MaterialTheme.typography.bodySmall,
                        )
                    }
                    HorizontalDivider()
                }
                if (carregando) CircularProgressIndicator()
                if (erro.isNotBlank()) {
                    Text(erro, color = MaterialTheme.colorScheme.error)
                    TextButton(
                        onClick = {
                            val id = leituraPendente
                            if (id != null) marcarLida(id) else tentativa++
                        }
                    ) {
                        Text("Tentar novamente")
                    }
                }
                if (!carregando && erro.isBlank() && itens.isEmpty()) Text("Nenhuma notificação.")
                if (
                    !carregando &&
                        lendo == null &&
                        !fim &&
                        erro.isBlank() &&
                        itens.size < total &&
                        pagina > 0
                )
                    TextButton(
                        onClick = {
                            proxima = pagina + 1
                            tentativa++
                        }
                    ) {
                        Text("Carregar mais")
                    }
            }
        }
    }
}

@Composable
internal fun PreferenciasNotificacoes(token: String?, onSessaoExpirada: () -> Unit) {
    val api = remember { NotificacoesApi() }
    val scope = rememberCoroutineScope()
    val expirar by rememberUpdatedState(onSessaoExpirada)
    var habilitado by remember(token) { mutableStateOf<Boolean?>(null) }
    var carregando by remember(token) { mutableStateOf(false) }
    var erro by remember(token) { mutableStateOf("") }
    var tentativa by remember(token) { mutableIntStateOf(0) }
    var pendente by remember(token) { mutableStateOf<Boolean?>(null) }
    fun salvar(valor: Boolean) {
        scope.launch {
            carregando = true
            erro = ""
            pendente = null
            try {
                habilitado = withContext(Dispatchers.IO) { api.salvar(token!!, valor) }
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                if (e is ApiException && e.status == 401) expirar()
                else {
                    pendente = valor
                    erro =
                        (e as? ApiException)?.userMessage
                            ?: "Não foi possível salvar a preferência."
                }
            } finally {
                carregando = false
            }
        }
    }
    LaunchedEffect(token, tentativa) {
        if (token == null) {
            expirar()
            return@LaunchedEffect
        }
        carregando = true
        erro = ""
        try {
            habilitado = withContext(Dispatchers.IO) { api.preferencias(token) }
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            if (e is ApiException && e.status == 401) expirar()
            else
                erro =
                    (e as? ApiException)?.userMessage
                        ?: "Não foi possível carregar as preferências."
        } finally {
            carregando = false
        }
    }
    Column(Modifier.fillMaxWidth().padding(12.dp)) {
        if (habilitado != null)
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                Text("Notificações por e-mail", modifier = Modifier.weight(1f))
                Switch(
                    checked = habilitado == true,
                    enabled = !carregando,
                    onCheckedChange = { valor -> salvar(valor) },
                )
            }
        if (carregando) CircularProgressIndicator()
        if (erro.isNotBlank()) {
            Text(erro, color = MaterialTheme.colorScheme.error)
            TextButton(
                onClick = {
                    val valor = pendente
                    if (valor != null) salvar(valor) else tentativa++
                }
            ) {
                Text("Tentar novamente")
            }
        }
    }
}
