package br.com.alocca.plantoes

import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.math.BigDecimal
import androidx.compose.foundation.BorderStroke
import androidx.compose.ui.graphics.Color

internal data class IndicadoresGestor(
    val atualizadoEm: String, val plantoes: Int, val medicos: Int, val vagas: Int,
    val pago: BigDecimal, val aPagar: BigDecimal, val atrasado: BigDecimal,
) {
    val vazio get() = plantoes == 0 && medicos == 0 && vagas == 0 &&
        listOf(pago, aPagar, atrasado).all { it.compareTo(BigDecimal.ZERO) == 0 }
}

internal class GestorIndicadoresCliente(
    private val enviar: (String, String, String) -> ApiHttp.Resposta = { path, method, token ->
        ApiHttp.enviar(path, method, token = token)
    },
) {
    fun buscar(token: String): IndicadoresGestor {
        val resposta = enviar("gestor/indicadores", "GET", token)
        if (resposta.status == 0) throw ApiException(ApiHttp.CONNECTION_ERROR, 0)
        if (resposta.status !in 200..299) {
            val message = runCatching { JSONObject(resposta.texto).optString("message") }.getOrNull()
            throw ApiException(message?.takeIf { it.isNotBlank() } ?: "Não foi possível carregar os indicadores.", resposta.status)
        }
        return try { parse(JSONObject(resposta.texto)) } catch (_: Exception) {
            throw ApiException("O servidor retornou uma resposta inválida.", resposta.status)
        }
    }

    internal fun parse(json: JSONObject): IndicadoresGestor {
        require(json.getString("periodo") == "todo_historico")
        val data = json.getString("atualizado_em")
        require(Datas.parseIso(data) != null)
        fun contagem(key: String): Int {
            val value = json.get(key)
            require(value is Int || value is Long)
            val n = (value as Number).toLong()
            require(n in 0..Int.MAX_VALUE.toLong())
            return n.toInt()
        }
        val pagamentos = json.getJSONObject("pagamentos")
        fun valor(key: String): BigDecimal {
            val value = pagamentos.get(key)
            require(value is String && value.matches(Regex("[0-9]+(\\.[0-9]+)?")))
            return BigDecimal(value)
        }
        return IndicadoresGestor(data, contagem("plantoes"), contagem("medicos_vinculados"), contagem("vagas_preenchidas"),
            valor("total_pago"), valor("total_a_pagar"), valor("total_em_atraso"))
    }
}

internal fun formatarValorIndicador(valor: BigDecimal): String =
    Datas.moeda(valor)

@Composable
internal fun IndicadoresGestorConteudo(token: String?, onSessaoExpirada: () -> Unit) {
    var dados by remember(token) { mutableStateOf<IndicadoresGestor?>(null) }
    var carregando by remember(token) { mutableStateOf(true) }
    var erro by remember(token) { mutableStateOf("") }
    var tentativa by remember(token) { mutableIntStateOf(0) }
    val expirar by rememberUpdatedState(onSessaoExpirada)
    LaunchedEffect(token, tentativa) {
        carregando = true
        erro = ""
        try {
            if (token == null) { expirar(); return@LaunchedEffect }
            dados = withContext(Dispatchers.IO) { GestorIndicadoresCliente().buscar(token) }
        } catch (cancelled: CancellationException) {
            throw cancelled
        } catch (failure: Exception) {
            if (failure is ApiException && failure.status == 401) expirar()
            else erro = (failure as? ApiException)?.userMessage ?: "Não foi possível carregar os indicadores."
        } finally { carregando = false }
    }
    Card(Modifier.fillMaxWidth(), colors = CardDefaults.cardColors(containerColor = Color.White), border = BorderStroke(1.dp, Color(0xFFE0E5E5))) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text("Indicadores • todo o histórico", style = MaterialTheme.typography.titleMedium)
            Text("Instituições ativas que você administra; plantões não cancelados ou excluídos.", style = MaterialTheme.typography.bodySmall)
            when {
                carregando && dados == null -> CircularProgressIndicator()
                erro.isNotBlank() && dados == null -> {
                    Text(erro, color = MaterialTheme.colorScheme.error)
                    TextButton(onClick = { tentativa++ }) { Text("Tentar novamente") }
                }
                dados != null -> {
                    val d = dados!!
                    if (d.vazio) Text("Nenhum dado no histórico das suas instituições.")
                    Text("Plantões no histórico: ${d.plantoes}")
                    Text("Médicos com alocação no histórico: ${d.medicos}")
                    Text("Cada médico conta uma vez, inclusive após pagamento.", style = MaterialTheme.typography.bodySmall)
                    Text("Vagas preenchidas: ${d.vagas}")
                    Text("Total pago: ${formatarValorIndicador(d.pago)}")
                    Text("A pagar (a vencer ou sem vencimento): ${formatarValorIndicador(d.aPagar)}")
                    Text("Em atraso: ${formatarValorIndicador(d.atrasado)}")
                    Text("Atualizado em ${Datas.dataHora(Datas.parseIso(d.atualizadoEm)!!)}", style = MaterialTheme.typography.bodySmall)
                    if (erro.isNotBlank()) Text(erro, color = MaterialTheme.colorScheme.error)
                    if (carregando) CircularProgressIndicator()
                    else TextButton(onClick = { tentativa++ }) { Text("Atualizar") }
                }
            }
        }
    }
}
