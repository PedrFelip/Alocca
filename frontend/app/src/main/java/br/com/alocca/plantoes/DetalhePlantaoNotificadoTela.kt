package br.com.alocca.plantoes

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONObject

/** Detalhe do UUID selecionado, autorizado pelo destinatário da notificação. */
@Composable
internal fun DetalhePlantaoNotificadoTela(id: String, onBack: () -> Unit) {
    val context = LocalContext.current
    var tentativa by remember(id) { mutableIntStateOf(0) }
    var dados by remember(id) { mutableStateOf<JSONObject?>(null) }
    var erro by remember(id) { mutableStateOf("") }
    var carregando by remember(id) { mutableStateOf(true) }
    BackHandler(onBack = onBack)
    LaunchedEffect(id, tentativa) {
        carregando = true; erro = ""
        val resultado = withContext(Dispatchers.IO) {
            val token = TokenStore.read(context)
            if (token == null) Resposta.Falha(NOTIFICACAO_MSG_SESSAO_EXPIRADA, 401)
            else Sessao.consultar(context, token) { NotificacoesApi.plantao(it, id) }
        }
        when (resultado) {
            is Resposta.Ok -> dados = resultado.dados
            is Resposta.Falha -> erro = resultado.mensagem
        }
        carregando = false
    }
    Column(Modifier.fillMaxSize().statusBarsPadding().navigationBarsPadding().padding(20.dp)) {
        TextButton(onClick = onBack) { Text("‹ Voltar") }
        Text("Plantão da notificação", style = MaterialTheme.typography.headlineSmall)
        if (carregando) CircularProgressIndicator()
        if (erro.isNotBlank()) { Text(erro); TextButton(onClick = { tentativa++ }) { Text("Tentar novamente") } }
        dados?.let { p ->
            Spacer(Modifier.height(16.dp))
            Text(p.optString("titulo"), style = MaterialTheme.typography.titleLarge)
            Text(p.optString("instituicao")); Text(p.optString("local")); Text(p.optString("especialidade"))
            Text("${PlantoesApi.formatarDataHora(p.optString("inicio"))} — ${PlantoesApi.formatarDataHora(p.optString("fim"))}")
            Text("Valor: R$ ${p.optString("valor")}"); Text("Status: ${p.optString("status")}")
        }
    }
}
