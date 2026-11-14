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
internal fun PlantoesScreen(gestor: Boolean, onBack: () -> Unit, inicial: ItemPlantao? = null) {
    val context = LocalContext.current
    val repository = remember(context) { HttpPlantoesRepository(TokenStore.read(context).orEmpty()) }
    PlantoesScreen(gestor, onBack, repository, inicial)
}

@Composable
internal fun PlantoesScreen(gestor: Boolean, onBack: () -> Unit, repository: PlantoesRepository, inicial: ItemPlantao? = null) {
    var aba by remember { mutableIntStateOf(0) }
    var plantao by remember { mutableStateOf(inicial) }
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
    val voltar = { if (!enviando) { if (plantao != null && inicial == null) plantao = null else onBack() } }
    BackHandler(onBack = voltar)
    LaunchedEffect(repository, gestor, plantao?.id, aba, pagina, revisao) {
        carregando = true; erro = ""; itens = emptyList()
        val resultado = when {
            gestor && plantao != null -> repository.candidatos(plantao!!.id)
            gestor -> repository.plantoesGestor(pagina)
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
        Text(if (gestor) plantao?.titulo ?: "Plantões da instituição" else "Plantões", style = MaterialTheme.typography.headlineSmall, color = Navy)
        if (!gestor) Row { TextButton(enabled = !enviando, onClick = { aba = 0; pagina = 0 }) { Text("Feed") }; TextButton(enabled = !enviando, onClick = { aba = 1; pagina = 0 }) { Text("Minhas candidaturas") } }
        if (carregando || enviando) LinearProgressIndicator(Modifier.fillMaxWidth())
        if (erro.isNotBlank()) { Text(erro, color = MaterialTheme.colorScheme.error); TextButton(onClick = { revisao++ }) { Text("Tentar novamente") } }
        if (aviso.isNotBlank()) Text(aviso, color = MaterialTheme.colorScheme.primary)
        // Prepara campos de exibição uma vez por lista/modo, mantendo o item para ações.
        val linhas = remember(itens, gestor, plantao?.id) {
            linhasPlantoes(itens, modoCandidaturas = gestor && plantao != null)
        }
        Column(Modifier.weight(1f).verticalScroll(rememberScrollState())) {
            if (!carregando && erro.isEmpty() && itens.isEmpty()) Text("Nenhum resultado encontrado.")
            linhas.forEach { linha ->
                Card(Modifier.fillMaxWidth().padding(vertical = 6.dp)) { Column(Modifier.padding(14.dp)) {
                    when (linha) {
                        is LinhaPlantoes.Candidatura -> {
                            Text(linha.nomeMedico, style = MaterialTheme.typography.titleMedium)
                            Text(linha.crmStatus)
                            linha.mensagem?.let { Text(it) }
                            if (linha.item.status == "PENDENTE") Button(enabled = !carregando && !enviando, onClick = { selecionado = linha.item }) { Text("Aprovar") }
                        }
                        is LinhaPlantoes.Turno -> {
                            Text(linha.item.titulo, style = MaterialTheme.typography.titleMedium)
                            Text(linha.detalhes)
                            Text(linha.periodo, color = Navy)
                            linha.item.valor?.let { Text("Valor: R$ $it") }
                            if (!gestor && aba == 1) Text("Status: ${linha.item.status}")
                            if (gestor) TextButton(enabled = !enviando, onClick = { plantao = linha.item; aviso = "" }) { Text("Ver candidaturas") }
                            else if (aba == 0) Button(enabled = !carregando && !enviando, onClick = { selecionado = linha.item }) { Text("Candidatar-me") }
                        }
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

/** Linha de tela imutável: item de origem + campos de exibição prontos. */
internal sealed interface LinhaPlantoes {
    val item: ItemPlantao

    /** Candidatura vista pelo gestor (sem datas de plantão). */
    data class Candidatura(
        override val item: ItemPlantao,
        val nomeMedico: String,
        val crmStatus: String,
        val mensagem: String?,
    ) : LinhaPlantoes

    /** Plantão (feed, minhas candidaturas ou lista gerenciada do gestor). */
    data class Turno(
        override val item: ItemPlantao,
        val detalhes: String,
        val periodo: String,
    ) : LinhaPlantoes
}

/** Prepara as linhas da tela uma vez por lista/modo; pura e testável. */
internal fun linhasPlantoes(itens: List<ItemPlantao>, modoCandidaturas: Boolean): List<LinhaPlantoes> =
    if (modoCandidaturas) itens.map { item ->
        LinhaPlantoes.Candidatura(
            item = item,
            nomeMedico = item.medico.ifBlank { "Médico" },
            crmStatus = "CRM: ${item.crm}  •  ${item.status}",
            mensagem = item.mensagem.takeIf { it.isNotBlank() },
        )
    }
    else itens.map { item ->
        LinhaPlantoes.Turno(
            item = item,
            detalhes = listOf(item.instituicao, item.especialidade, item.local).filter { it.isNotBlank() }.joinToString(" • "),
            periodo = "${PlantoesApi.formatarDataHora(item.inicio)} — ${PlantoesApi.formatarDataHora(item.fim)}",
        )
    }
