package br.com.alocca.plantoes

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.selection.toggleable
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONArray

internal data class MedicoConvidavel(val id: String, val nome: String, val detalhes: String)

@Composable
internal fun ConvitesPlantaoDialog(
    token: String?,
    instituicaoId: String,
    selecionados: Set<String>,
    onConfirm: (Set<String>) -> Unit,
    onDismiss: () -> Unit,
) {
    var medicos by remember { mutableStateOf<List<MedicoConvidavel>>(emptyList()) }
    var escolhidos by remember { mutableStateOf(selecionados) }
    var busca by remember { mutableStateOf("") }
    var erro by remember { mutableStateOf("") }
    var carregando by remember { mutableStateOf(true) }
    var tentativa by remember { mutableIntStateOf(0) }
    LaunchedEffect(token, instituicaoId, tentativa) {
        carregando = true
        erro = ""
        val resultado = withContext(Dispatchers.IO) {
            runCatching {
                if (token == null) throw ApiException(PlantoesApi.MSG_SESSAO_EXPIRADA, 401)
                val resposta = ApiHttp.enviar("plantoes/medicos-convidaveis?instituicao_id=$instituicaoId", "GET", token = token)
                if (resposta.status == 0) throw ApiException(ApiHttp.CONNECTION_ERROR, 0)
                if (resposta.status !in 200..299) throw ApiException("Não foi possível carregar os médicos.", resposta.status)
                val lista = JSONArray(resposta.texto)
                (0 until lista.length()).map { indice ->
                    val medico = lista.getJSONObject(indice)
                    MedicoConvidavel(
                        medico.getString("id"), medico.getString("nome"),
                        "CRM ${medico.getString("crm")}/${medico.getString("uf_crm")} • ${medico.optString("especialidade").takeUnless { it == "null" }.orEmpty()}",
                    )
                }
            }
        }
        resultado.fold(
            onSuccess = { lista ->
                medicos = lista
                escolhidos = escolhidos.intersect(lista.map { it.id }.toSet())
            },
            onFailure = { erro = (it as? ApiException)?.userMessage ?: "Não foi possível carregar os médicos." },
        )
        carregando = false
    }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Convidar médicos (${escolhidos.size}/100)") },
        text = {
            Column {
                Text("Os convites serão enviados nas notificações do app após publicar. Não reservam vagas nem confirmam alocação.")
                OutlinedTextField(busca, { busca = it }, label = { Text("Buscar nome, CRM ou especialidade") }, modifier = Modifier.fillMaxWidth(), singleLine = true)
                if (carregando) LinearProgressIndicator(Modifier.fillMaxWidth())
                if (erro.isNotBlank()) {
                    Text(erro, color = MaterialTheme.colorScheme.error)
                    TextButton(onClick = { tentativa++ }) { Text("Tentar novamente") }
                }
                val filtrados = medicos.filter { "${it.nome} ${it.detalhes}".contains(busca.trim(), ignoreCase = true) }
                Column(Modifier.heightIn(max = 320.dp).verticalScroll(rememberScrollState())) {
                    if (!carregando && erro.isBlank() && filtrados.isEmpty()) Text("Nenhum médico encontrado.")
                    filtrados.forEach { medico ->
                        val marcado = medico.id in escolhidos
                        Row(Modifier.fillMaxWidth().toggleable(
                            value = marcado,
                            enabled = !carregando && (marcado || escolhidos.size < 100),
                            role = Role.Checkbox,
                            onValueChange = { escolhidos = if (it) escolhidos + medico.id else escolhidos - medico.id },
                        ).padding(vertical = 8.dp)) {
                            Checkbox(checked = marcado, onCheckedChange = null)
                            Column(Modifier.padding(start = 8.dp)) {
                                Text(medico.nome)
                                Text(medico.detalhes, style = MaterialTheme.typography.bodySmall)
                            }
                        }
                    }
                }
            }
        },
        confirmButton = { TextButton(enabled = !carregando && erro.isBlank(), onClick = { onConfirm(escolhidos) }) { Text("Confirmar seleção") } },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Cancelar") } },
    )
}
