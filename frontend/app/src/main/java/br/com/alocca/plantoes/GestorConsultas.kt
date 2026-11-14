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
import java.net.URLEncoder
import java.text.SimpleDateFormat
import java.util.Calendar
import java.util.TimeZone
import java.util.Locale

internal data class ConsultaGestorItem(val id: String, val titulo: String, val detalhe: String)

internal data class FiltrosConsulta(
    val q: String = "", val especialidade: String = "", val status: String = "",
    val validacao: String = "", val uf: String = "", val instituicao: String = "",
    val medico: String = "", val inicio: String = "", val fim: String = "", val evento: String = "",
)

internal object ConsultaFiltros {
    private val uuid = Regex("^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89aAbB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$")
    private val ufs = "AC AL AP AM BA CE DF ES GO MA MT MS MG PA PB PR PE PI RJ RN RS RO RR SC SP SE TO".split(" ")

    fun parametros(f: FiltrosConsulta, ponto: Boolean, zone: TimeZone = TimeZone.getDefault()): Map<String, String> {
        val result = linkedMapOf<String, String>()
        fun add(key: String, value: String) { if (value.isNotBlank()) result[key] = value.trim() }
        val instituicao = f.instituicao.trim()
        require(instituicao.isEmpty() || uuid.matches(instituicao)) { "Informe um ID de instituição válido (UUID)." }
        add("instituicao_id", instituicao)
        if (ponto) {
            val medico = f.medico.trim()
            require(medico.isEmpty() || uuid.matches(medico)) { "Informe um ID de médico válido (UUID)." }
            add("medico_id", medico)
            val inicio = data(f.inicio, zone)
            val fim = data(f.fim, zone)
            require(inicio == null || fim == null || !inicio.after(fim)) { "A data inicial deve ser anterior ou igual à final." }
            val formato = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ssXXX", Locale.US).apply { timeZone = zone }
            if (inicio != null) result["inicio"] = formato.format(inicio)
            if (fim != null) {
                val diaSeguinte = Calendar.getInstance(zone).apply { time = fim; add(Calendar.DAY_OF_MONTH, 1) }
                result["fim"] = formato.format(diaSeguinte.time)
            }
            add("tipo_evento", f.evento)
        } else {
            require(f.q.trim().length <= 150 && f.especialidade.trim().length <= 150) { "Busca e especialidade devem ter até 150 caracteres." }
            val uf = f.uf.trim().uppercase(Locale.ROOT)
            require(uf.isEmpty() || uf in ufs) { "Informe uma UF de CRM válida." }
            add("q", f.q); add("especialidade", f.especialidade); add("status", f.status)
            add("status_validacao", f.validacao); add("uf_crm", uf)
        }
        return result
    }

    private fun data(value: String, zone: TimeZone): java.util.Date? {
        if (value.isBlank()) return null
        require(Regex("^\\d{4}-\\d{2}-\\d{2}$").matches(value)) { "Use datas no formato AAAA-MM-DD." }
        return try {
            SimpleDateFormat("yyyy-MM-dd", Locale.US).apply { isLenient = false; timeZone = zone }.parse(value)
                ?: throw IllegalArgumentException()
        } catch (_: Exception) { throw IllegalArgumentException("Informe datas válidas no formato AAAA-MM-DD.") }
    }
}

internal object GestorConsultasApi {
    const val PAGE_SIZE = 20

    fun listar(token: String, ponto: Boolean, offset: Int, filtros: Map<String, String> = emptyMap()): List<ConsultaGestorItem> {
        val resposta = ApiHttp.enviar(caminho(ponto, offset, filtros), "GET", token = token)
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

    internal fun caminho(ponto: Boolean, offset: Int, filtros: Map<String, String>): String {
        val recurso = if (ponto) "ponto" else "medicos"
        val query = (linkedMapOf("limit" to PAGE_SIZE.toString(), "offset" to offset.toString()) + filtros)
            .entries.joinToString("&") { (key, value) -> "$key=${URLEncoder.encode(value, "UTF-8")}" }
        return "gestor/$recurso?$query"
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
    var request by remember(token, ponto) { mutableIntStateOf(0) }
    var draft by remember(token, ponto) { mutableStateOf(FiltrosConsulta()) }
    var filtros by remember(token, ponto) { mutableStateOf<Map<String, String>>(emptyMap()) }
    var erroFiltro by remember(token, ponto) { mutableStateOf("") }
    val sessaoExpirada by rememberUpdatedState(onSessaoExpirada)
    LaunchedEffect(token, ponto, request) {
        val geracao = request
        val paginaOffset = offset
        val paginaFiltros = filtros.toMap()
        loading = true
        error = ""
        try {
            if (token == null) {
                sessaoExpirada()
                return@LaunchedEffect
            }
            val page = withContext(Dispatchers.IO) { GestorConsultasApi.listar(token, ponto, paginaOffset, paginaFiltros) }
            if (geracao != request) return@LaunchedEffect
            items = if (paginaOffset == 0) page else (items + page).distinctBy { it.id }
            offset = paginaOffset + page.size
            more = page.size == GestorConsultasApi.PAGE_SIZE
        } catch (cancelled: CancellationException) {
            throw cancelled
        } catch (failure: Exception) {
            if (geracao != request) return@LaunchedEffect
            if (failure is ApiException && failure.status == 401) sessaoExpirada()
            else error = (failure as? ApiException)?.userMessage ?: "Não foi possível carregar os dados."
        } finally {
            if (geracao == request) loading = false
        }
    }
    Column(Modifier.weight(1f).fillMaxWidth().verticalScroll(rememberScrollState()).padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        if (ponto) {
            SeletorMedico(token, draft.medico, sessaoExpirada) { draft = draft.copy(medico = it) }
            OutlinedTextField(draft.inicio, { draft = draft.copy(inicio = it) }, label = { Text("Data inicial (AAAA-MM-DD)") }, modifier = Modifier.fillMaxWidth(), singleLine = true)
            OutlinedTextField(draft.fim, { draft = draft.copy(fim = it) }, label = { Text("Data final inclusiva (AAAA-MM-DD)") }, modifier = Modifier.fillMaxWidth(), singleLine = true)
            OpcaoConsulta("Evento", draft.evento, listOf("" to "Todos", "ENTRADA" to "Entrada", "SAIDA" to "Saída")) { draft = draft.copy(evento = it) }
        } else {
            OutlinedTextField(draft.q, { draft = draft.copy(q = it) }, label = { Text("Nome, CRM ou especialidade") }, modifier = Modifier.fillMaxWidth(), singleLine = true)
            OutlinedTextField(draft.especialidade, { draft = draft.copy(especialidade = it) }, label = { Text("Especialidade") }, modifier = Modifier.fillMaxWidth(), singleLine = true)
            OutlinedTextField(draft.uf, { draft = draft.copy(uf = it) }, label = { Text("UF do CRM") }, modifier = Modifier.fillMaxWidth(), singleLine = true)
            OpcaoConsulta("Conta", draft.status, listOf("" to "Todas", "ATIVO" to "Ativa", "INATIVO" to "Inativa", "BLOQUEADO" to "Bloqueada")) { draft = draft.copy(status = it) }
            OpcaoConsulta("Validação", draft.validacao, listOf("" to "Todas", "PENDENTE" to "Pendente", "APROVADO" to "Aprovada", "REJEITADO" to "Rejeitada")) { draft = draft.copy(validacao = it) }
        }
        SeletorInstituicao(token, draft.instituicao, sessaoExpirada) { draft = draft.copy(instituicao = it) }
        if (erroFiltro.isNotBlank()) Text(erroFiltro, color = MaterialTheme.colorScheme.error)
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Button(onClick = {
                try {
                    filtros = ConsultaFiltros.parametros(draft, ponto)
                    erroFiltro = ""; items = emptyList(); offset = 0; more = false; request++
                } catch (e: IllegalArgumentException) { erroFiltro = e.message ?: "Filtros inválidos." }
            }) { Text("Aplicar filtros") }
            TextButton(onClick = {
                draft = FiltrosConsulta(); filtros = emptyMap(); erroFiltro = ""
                items = emptyList(); offset = 0; more = false; request++
            }) { Text("Limpar") }
        }
        TextButton(enabled = !loading, onClick = { offset = 0; items = emptyList(); request++ }) { Text("Atualizar") }
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

@Composable
private fun OpcaoConsulta(label: String, selecionado: String, opcoes: List<Pair<String, String>>, onSelect: (String) -> Unit) {
    var aberto by remember { mutableStateOf(false) }
    Box {
        OutlinedButton(onClick = { aberto = true }) { Text("$label: ${opcoes.firstOrNull { it.first == selecionado }?.second ?: "Indisponível"}") }
        DropdownMenu(expanded = aberto, onDismissRequest = { aberto = false }) {
            opcoes.forEach { (valor, texto) ->
                DropdownMenuItem(text = { Text(texto) }, onClick = { onSelect(valor); aberto = false })
            }
        }
    }
}

@Composable
private fun SeletorInstituicao(token: String?, selecionado: String, onSessao: () -> Unit, onSelect: (String) -> Unit) {
    var instituicoes by remember(token) { mutableStateOf<List<InstituicaoVinculada>>(emptyList()) }
    var carregando by remember(token) { mutableStateOf(true) }
    var erro by remember(token) { mutableStateOf("") }
    var tentativa by remember(token) { mutableIntStateOf(0) }
    LaunchedEffect(token, tentativa) {
        carregando = true; erro = ""
        try {
            if (token == null) { onSessao(); return@LaunchedEffect }
            instituicoes = withContext(Dispatchers.IO) { PlantoesApi.listarInstituicoesVinculadas(token) }
        } catch (e: CancellationException) { throw e }
        catch (e: Exception) {
            if (e is ApiException && e.status == 401) onSessao()
            else erro = (e as? ApiException)?.userMessage ?: "Não foi possível carregar as instituições."
        } finally { carregando = false }
    }
    when {
        carregando -> Text("Carregando instituições…")
        erro.isNotBlank() -> { Text(erro, color = MaterialTheme.colorScheme.error); TextButton(onClick = { tentativa++ }) { Text("Tentar novamente") } }
        else -> OpcaoConsulta("Instituição", selecionado, listOf("" to "Todas") + instituicoes.map { it.id to (it.nomeFantasia?.takeIf { nome -> nome.isNotBlank() } ?: it.nome) }, onSelect)
    }
}

@Composable
private fun SeletorMedico(token: String?, selecionado: String, onSessao: () -> Unit, onSelect: (String) -> Unit) {
    var aberto by remember { mutableStateOf(false) }
    var busca by remember { mutableStateOf("") }
    var consulta by remember { mutableStateOf("") }
    var itens by remember(token) { mutableStateOf<List<ConsultaGestorItem>>(emptyList()) }
    var escolhido by remember(token) { mutableStateOf<ConsultaGestorItem?>(null) }
    var offset by remember(token) { mutableIntStateOf(0) }
    var mais by remember(token) { mutableStateOf(false) }
    var carregando by remember(token) { mutableStateOf(false) }
    var erro by remember(token) { mutableStateOf("") }
    var geracao by remember(token) { mutableIntStateOf(0) }
    LaunchedEffect(token, geracao) {
        if (geracao == 0) return@LaunchedEffect
        val atual = geracao; val pagina = offset; val q = consulta
        carregando = true; erro = ""
        try {
            if (token == null) { onSessao(); return@LaunchedEffect }
            val resultado = withContext(Dispatchers.IO) {
                GestorConsultasApi.listar(token, false, pagina, if (q.isBlank()) emptyMap() else mapOf("q" to q))
            }
            if (atual != geracao) return@LaunchedEffect
            itens = if (pagina == 0) resultado else (itens + resultado).distinctBy { it.id }
            offset = pagina + resultado.size; mais = resultado.size == GestorConsultasApi.PAGE_SIZE
        } catch (e: CancellationException) { throw e }
        catch (e: Exception) {
            if (atual != geracao) return@LaunchedEffect
            if (e is ApiException && e.status == 401) onSessao()
            else erro = (e as? ApiException)?.userMessage ?: "Não foi possível carregar os médicos."
        } finally { if (atual == geracao) carregando = false }
    }
    OutlinedButton(onClick = { aberto = !aberto; if (aberto && geracao == 0) geracao++ }) {
        Text("Médico: ${if (selecionado.isEmpty()) "Todos" else escolhido?.titulo ?: "Selecionado"}")
    }
    if (aberto) {
        OutlinedTextField(busca, { busca = it }, label = { Text("Buscar nome, CRM ou especialidade") }, modifier = Modifier.fillMaxWidth(), singleLine = true)
        Row {
            TextButton(onClick = {
                if (busca.trim().length > 150) erro = "Busca deve ter até 150 caracteres."
                else { consulta = busca.trim(); offset = 0; itens = emptyList(); mais = false; geracao++ }
            }) { Text("Buscar") }
            TextButton(onClick = { onSelect(""); escolhido = null; aberto = false }) { Text("Todos os médicos") }
        }
        itens.forEach { item ->
            TextButton(onClick = { escolhido = item; onSelect(item.id); aberto = false }) {
                Text("${item.titulo} • ${item.detalhe.lineSequence().first()}")
            }
        }
        when {
            carregando -> CircularProgressIndicator()
            erro.isNotBlank() -> { Text(erro, color = MaterialTheme.colorScheme.error); TextButton(onClick = { geracao++ }) { Text("Tentar novamente") } }
            itens.isEmpty() -> Text("Nenhum médico encontrado.")
            mais -> TextButton(onClick = { geracao++ }) { Text("Carregar mais médicos") }
        }
    }
}
