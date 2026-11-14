package br.com.alocca.plantoes

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import java.text.SimpleDateFormat
import java.util.Locale

internal data class ConsultaGestorItem(val id: String, val titulo: String, val detalhe: String)

internal object GestorConsultasApi {
    const val PAGE_SIZE = 20

    fun listar(token: String, ponto: Boolean, offset: Int): List<ConsultaGestorItem> {
        val recurso = if (ponto) "ponto" else "medicos"
        val resposta = ApiHttp.enviar("gestor/$recurso?limit=$PAGE_SIZE&offset=$offset", "GET", token = token)
        if (resposta.status == 0) throw ApiException(ApiHttp.CONNECTION_ERROR, 0)
        if (resposta.status !in 200..299) {
            val message = runCatching { JSONObject(resposta.texto).optString("message") }.getOrNull()
            throw ApiException(message?.takeIf { it.isNotBlank() } ?: "Não foi possível carregar os dados.", resposta.status)
        }
        return try {
            val array = JSONArray(resposta.texto)
            List(array.length()) { index -> parseItem(array.getJSONObject(index), ponto) }
        } catch (failure: Exception) {
            throw ApiException("O servidor retornou uma resposta inválida.", resposta.status)
        }
    }

    internal fun parseItem(json: JSONObject, ponto: Boolean): ConsultaGestorItem {
        if (!ponto) {
            val especialidade = json.optString("especialidade").takeUnless { it.isBlank() || it == "null" } ?: "Especialidade não informada"
            return ConsultaGestorItem(json.getString("id"), json.getString("nome"),
                "CRM ${json.getString("crm")}/${json.getString("uf_crm")}\n$especialidade\nConta: ${json.getString("status")} • Validação: ${json.getString("status_validacao")}")
        }
        val medico = json.getJSONObject("medico")
        val instant = Datas.parseIso(json.getString("timestamp_servidor"))
            ?: throw IllegalArgumentException("Data inválida")
        val data = SimpleDateFormat("dd/MM/yyyy HH:mm", Locale("pt", "BR")).format(instant)
        val evento = when (json.getString("tipo_evento")) {
            "ENTRADA" -> "Entrada"
            "SAIDA" -> "Saída"
            else -> throw IllegalArgumentException("Evento inválido")
        }
        val local = if (json.getBoolean("com_localizacao")) "Localização informada" else "Sem localização informada"
        return ConsultaGestorItem(json.getString("id"), "${medico.getString("nome")} • $evento",
            "CRM ${medico.getString("crm")}/${medico.getString("uf_crm")}\n${json.getJSONObject("instituicao").getString("nome")}\n${json.getJSONObject("plantao").getString("titulo")}\n$data\n$local")
    }
}

@Composable
internal fun ColumnScope.GestorConsultaConteudo(token: String?, ponto: Boolean, onSessaoExpirada: () -> Unit) {
    var items by remember(token, ponto) { mutableStateOf<List<ConsultaGestorItem>>(emptyList()) }
    var offset by remember(token, ponto) { mutableStateOf(0) }
    var more by remember(token, ponto) { mutableStateOf(false) }
    var loading by remember(token, ponto) { mutableStateOf(true) }
    var error by remember(token, ponto) { mutableStateOf("") }
    var request by remember { mutableStateOf(0) }
    val sessaoExpirada by rememberUpdatedState(onSessaoExpirada)
    LaunchedEffect(token, ponto, request) {
        loading = true
        error = ""
        try {
            if (token == null) {
                sessaoExpirada()
                return@LaunchedEffect
            }
            val page = withContext(Dispatchers.IO) { GestorConsultasApi.listar(token, ponto, offset) }
            items = if (offset == 0) page else (items + page).distinctBy { it.id }
            offset += page.size
            more = page.size == GestorConsultasApi.PAGE_SIZE
        } catch (cancelled: CancellationException) {
            throw cancelled
        } catch (failure: Exception) {
            if (failure is ApiException && failure.status == 401) sessaoExpirada()
            else error = (failure as? ApiException)?.userMessage ?: "Não foi possível carregar os dados."
        } finally {
            loading = false
        }
    }
    Column(Modifier.weight(1f).fillMaxWidth().verticalScroll(rememberScrollState()).padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        TextButton(enabled = !loading, onClick = { offset = 0; request++ }) { Text("Atualizar") }
        items.forEach { item ->
            Card(Modifier.fillMaxWidth()) {
                Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text(item.titulo, style = MaterialTheme.typography.titleMedium)
                    Text(item.detalhe, style = MaterialTheme.typography.bodyMedium)
                }
            }
        }
        when {
            loading -> CircularProgressIndicator()
            error.isNotBlank() -> {
                Text(error, color = MaterialTheme.colorScheme.error)
                TextButton(onClick = { request++ }) { Text("Tentar novamente") }
            }
            items.isEmpty() -> Text(if (ponto) "Nenhum registro de ponto nas suas instituições." else "Nenhum médico alocado nas suas instituições.")
            more -> TextButton(onClick = { request++ }) { Text("Carregar mais") }
        }
    }
}
