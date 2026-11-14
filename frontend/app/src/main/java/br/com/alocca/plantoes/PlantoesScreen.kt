package br.com.alocca.plantoes

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.launch

@Composable
internal fun PlantoesScreen(gestor: Boolean, onBack: () -> Unit) {
    val context = LocalContext.current
    val repository = remember(context) { HttpPlantoesRepository(TokenStore.read(context).orEmpty()) }
    PlantoesScreen(gestor, onBack, repository)
}

@Composable
internal fun PlantoesScreen(gestor: Boolean, onBack: () -> Unit, repository: PlantoesRepository) {
    var aba by remember { mutableIntStateOf(0) }
    var plantao by remember { mutableStateOf<ItemPlantao?>(null) }
    var itens by remember { mutableStateOf<List<ItemPlantao>>(emptyList()) }
    var erro by remember { mutableStateOf("") }
    var aviso by remember { mutableStateOf("") }
    var carregando by remember { mutableStateOf(false) }
    var revisao by remember { mutableIntStateOf(0) }
    var mensagem by remember { mutableStateOf("") }
    var selecionado by remember { mutableStateOf<ItemPlantao?>(null) }
    var pagina by remember { mutableIntStateOf(0) }
    val scope = rememberCoroutineScope()
    var enviando by remember { mutableStateOf(false) }
    val voltar = { if (!enviando) { if (plantao != null) plantao = null else onBack() } }
    BackHandler(onBack = voltar)
    LaunchedEffect(repository, gestor, plantao?.id, aba, pagina, revisao) {
        carregando = true; erro = ""; itens = emptyList()
        val resultado = when {
            gestor && plantao != null -> repository.candidatos(plantao!!.id)
            gestor -> repository.plantoesGestor()
            aba == 0 -> repository.feed(pagina)
            else -> repository.minhasCandidaturas(pagina)
        }
        when (resultado) {
            is Resultado.Sucesso -> itens = resultado.valor
            is Resultado.Erro -> erro = resultado.mensagem
        }
        carregando = false
    }
    fun acao(item: ItemPlantao) {
        if (enviando) return
        enviando = true; erro = ""; aviso = ""
        scope.launch {
            val resultado = if (gestor) repository.aprovar(plantao!!.id, item.id)
                else repository.candidatar(item.id, mensagem)
            enviando = false
            when (resultado) {
                is Resultado.Erro -> erro = resultado.mensagem
                is Resultado.Sucesso -> {
                    aviso = if (gestor) "Candidatura aprovada." else "Candidatura enviada."
                    selecionado = null; mensagem = ""; revisao++
                }
            }
        }
    }
    Column(Modifier.fillMaxSize().statusBarsPadding().navigationBarsPadding().padding(16.dp)) {
        TextButton(enabled = !enviando, onClick = voltar) { Text("‹ Voltar") }
        Text(if (gestor) plantao?.titulo ?: "Plantões da instituição" else "Plantões", style = MaterialTheme.typography.headlineSmall)
        if (!gestor) Row { TextButton(enabled = !enviando, onClick = { aba = 0; pagina = 0 }) { Text("Feed") }; TextButton(enabled = !enviando, onClick = { aba = 1; pagina = 0 }) { Text("Minhas candidaturas") } }
        if (carregando || enviando) LinearProgressIndicator(Modifier.fillMaxWidth())
        if (erro.isNotBlank()) { Text(erro, color = MaterialTheme.colorScheme.error); TextButton(onClick = { revisao++ }) { Text("Tentar novamente") } }
        if (aviso.isNotBlank()) Text(aviso, color = MaterialTheme.colorScheme.primary)
        Column(Modifier.weight(1f).verticalScroll(rememberScrollState())) {
            if (!carregando && erro.isEmpty() && itens.isEmpty()) Text("Nenhum resultado encontrado.")
            itens.forEach { item ->
                Card(Modifier.fillMaxWidth().padding(vertical = 6.dp)) { Column(Modifier.padding(14.dp)) {
                    if (gestor && plantao != null) {
                        Text(item.medico.ifBlank { "Médico" }, style = MaterialTheme.typography.titleMedium)
                        Text("CRM: ${item.crm}  •  ${item.status}")
                        item.mensagem.takeIf { it.isNotBlank() && it != "null" }?.let { Text(it) }
                        if (item.status == "PENDENTE") Button(enabled = !carregando && !enviando, onClick = { selecionado = item }) { Text("Aprovar") }
                    } else {
                        Text(item.titulo, style = MaterialTheme.typography.titleMedium)
                        Text(listOf(item.instituicao, item.especialidade, item.local).filter { it.isNotBlank() && it != "null" }.joinToString(" • "))
                        Text("${item.inicio} — ${item.fim}")
                        item.valor?.let { Text("Valor: R$ $it") }
                        if (!gestor && aba == 1) Text("Status: ${item.status}")
                        if (gestor) TextButton(enabled = !enviando, onClick = { plantao = item; aviso = "" }) { Text("Ver candidaturas") }
                        else if (aba == 0) Button(enabled = !carregando && !enviando, onClick = { selecionado = item }) { Text("Candidatar-me") }
                    }
                } }
            }
        }
        if (!gestor) Row { TextButton(enabled = pagina > 0 && !carregando && !enviando, onClick = { pagina-- }) { Text("Anterior") }; Text("Página ${pagina + 1}", Modifier.padding(12.dp)); TextButton(enabled = itens.size == 20 && !carregando && !enviando, onClick = { pagina++ }) { Text("Próxima") } }
    }
    selecionado?.let { item ->
        AlertDialog(onDismissRequest = { if (!enviando) { selecionado = null; mensagem = "" } }, title = { Text(if (gestor) "Aprovar candidatura?" else "Candidatar-se ao plantão") }, text = {
            Column {
            if (erro.isNotBlank()) Text(erro, color = MaterialTheme.colorScheme.error)
            if (gestor) Text("Confirmar a aprovação de ${item.medico}?")
            else OutlinedTextField(value = mensagem, enabled = !enviando, onValueChange = { if (it.length <= 1000) mensagem = it }, label = { Text("Mensagem opcional") })
            }
        }, confirmButton = { TextButton(enabled = !carregando && !enviando, onClick = {
            acao(item)
        }) { Text("Confirmar") } }, dismissButton = { TextButton(enabled = !carregando && !enviando, onClick = { selecionado = null; mensagem = "" }) { Text("Cancelar") } })
    }
}
