package br.com.alocca.plantoes

import android.os.Handler
import android.os.Looper
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import org.json.JSONObject

internal data class EdicaoPlantao(
    val titulo: String, val especialidade: String, val local: String, val descricao: String,
    val dataInicio: String, val horaInicio: String, val dataFim: String, val horaFim: String,
    val valor: String, val vagas: String,
) {
    fun payload(original: PlantaoGerenciado, agora: Long = System.currentTimeMillis()): JSONObject {
        require(titulo.isNotBlank() && titulo.trim().length <= 150) { "Informe um título de até 150 caracteres." }
        require(especialidade.isNotBlank() && especialidade.trim().length <= 100) { "Informe uma especialidade de até 100 caracteres." }
        require(local.isNotBlank() && local.trim().length <= 150) { "Informe um local de até 150 caracteres." }
        require(descricao.trim().length <= 2000 && (descricao.isNotBlank() || original.descricao.isBlank())) { "Informe observações de até 2000 caracteres; não é possível removê-las." }
        val inicio = PlantoesApi.paraIso(dataInicio, horaInicio) ?: throw IllegalArgumentException("Informe uma data e horário de início válidos.")
        val fim = PlantoesApi.paraIso(dataFim, horaFim) ?: throw IllegalArgumentException("Informe uma data e horário de término válidos.")
        val inicioAlterado = dataInicio != PlantoesApi.dataLocal(original.dataInicio) || horaInicio != PlantoesApi.formatarHora(original.dataInicio)
        val fimAlterado = dataFim != PlantoesApi.dataLocal(original.dataFim) || horaFim != PlantoesApi.formatarHora(original.dataFim)
        val inicioMillis = PlantoesApi.parseIso(if (inicioAlterado) inicio else original.dataInicio)?.time
        val fimMillis = PlantoesApi.parseIso(if (fimAlterado) fim else original.dataFim)?.time
        require(inicioMillis != null && inicioMillis > agora) { "O início deve estar no futuro." }
        require(fimMillis != null && fimMillis > inicioMillis) { "O término deve ser posterior ao início." }
        val textoValor = valor.trim().removePrefix("R$").trim().let { if (it.contains(',')) it.replace(".", "").replace(',', '.') else it }
        val numero = textoValor.toDoubleOrNull()
        require(numero != null && numero.isFinite() && numero >= 0.01 && numero <= 99_999_999.99 && kotlin.math.abs(numero * 100 - kotlin.math.round(numero * 100)) < 1e-6) { "Informe um valor válido com até duas casas decimais." }
        val quantidade = vagas.trim().toIntOrNull()
        require(quantidade != null && quantidade in 1..10_000 && quantidade >= original.vagasPreenchidas) { "Informe de 1 a 10.000 vagas, sem reduzir abaixo das vagas preenchidas." }
        return JSONObject().apply {
            if (titulo.trim() != original.titulo) put("titulo", titulo.trim())
            if (especialidade.trim() != original.especialidade) put("especialidade", especialidade.trim())
            if (local.trim() != original.localUnidade) put("local_unidade", local.trim())
            if (descricao.trim() != original.descricao) put("descricao", descricao.trim())
            if (inicioAlterado) put("data_inicio", inicio)
            if (fimAlterado) put("data_fim", fim)
            if (numero.compareTo(original.valor.toDoubleOrNull() ?: Double.NaN) != 0) put("valor", numero)
            if (quantidade != original.quantidadeVagas) put("quantidade_vagas", quantidade)
        }
    }
}

@Composable
internal fun GerenciarPlantaoDialog(plantao: PlantaoGerenciado, token: String?, onDismiss: () -> Unit, onSuccess: (String) -> Unit) {
    var modo by remember { mutableStateOf("") }
    var erro by remember { mutableStateOf("") }
    var enviando by remember { mutableStateOf(false) }
    var ativo by remember { mutableStateOf(true) }
    DisposableEffect(Unit) { onDispose { ativo = false } }
    var edicao by remember { mutableStateOf(EdicaoPlantao(plantao.titulo, plantao.especialidade, plantao.localUnidade, plantao.descricao, PlantoesApi.dataLocal(plantao.dataInicio), PlantoesApi.formatarHora(plantao.dataInicio), PlantoesApi.dataLocal(plantao.dataFim), PlantoesApi.formatarHora(plantao.dataFim), plantao.valor, plantao.quantidadeVagas.toString())) }
    fun enviar() {
        if (enviando) return
        val tokenAtual = token ?: run { erro = PlantoesApi.MSG_SESSAO_EXPIRADA; return }
        val payload = if (modo == "editar") try {
            edicao.payload(plantao).also { require(it.length() > 0) { "Altere ao menos um campo para salvar." } }
        } catch (e: IllegalArgumentException) { erro = e.message.orEmpty(); return } else null
        val operacao = modo
        enviando = true
        erro = ""
        Thread {
            val resultado = runCatching {
                when (operacao) {
                    "editar" -> PlantoesApi.alterarPlantao(tokenAtual, plantao.id, payload!!)
                    "cancelar" -> PlantoesApi.cancelarPlantao(tokenAtual, plantao.id)
                    else -> PlantoesApi.concluirPlantao(tokenAtual, plantao.id)
                }
            }
            Handler(Looper.getMainLooper()).post {
                if (ativo) {
                    enviando = false
                    resultado.fold(onSuccess = onSuccess, onFailure = { erro = (it as? ApiException)?.userMessage ?: "Não foi possível concluir a operação. Tente novamente." })
                }
            }
        }.start()
    }
    AlertDialog(
        onDismissRequest = { if (!enviando) onDismiss() },
        title = { Text(when (modo) { "editar" -> "Editar plantão"; "cancelar" -> "Cancelar plantão?"; "concluir" -> "Concluir plantão?"; else -> "Gerenciar plantão" }) },
        text = {
            Column(Modifier.verticalScroll(rememberScrollState())) {
                Text("${plantao.instituicaoNome} • ${plantao.titulo.ifBlank { plantao.especialidade }}")
                when (modo) {
                    "editar" -> {
                        Text("Com candidaturas ativas, datas, valor, especialidade e local ficam protegidos.")
                        CampoEdicao("Título", edicao.titulo) { edicao = edicao.copy(titulo = it) }
                        CampoEdicao("Especialidade", edicao.especialidade) { edicao = edicao.copy(especialidade = it) }
                        CampoEdicao("Local", edicao.local) { edicao = edicao.copy(local = it) }
                        DateTimePickerField("Data de início", edicao.dataInicio, { edicao = edicao.copy(dataInicio = it) })
                        DateTimePickerField("Hora de início", edicao.horaInicio, { edicao = edicao.copy(horaInicio = it) }, time = true)
                        DateTimePickerField("Data de término", edicao.dataFim, { edicao = edicao.copy(dataFim = it) })
                        DateTimePickerField("Hora de término", edicao.horaFim, { edicao = edicao.copy(horaFim = it) }, time = true)
                        CampoEdicao("Valor (R$)", edicao.valor) { edicao = edicao.copy(valor = it) }
                        CampoEdicao("Vagas", edicao.vagas) { edicao = edicao.copy(vagas = it) }
                        CampoEdicao("Observações", edicao.descricao) { edicao = edicao.copy(descricao = it) }
                    }
                    "cancelar" -> Text("O cancelamento encerra as candidaturas e libera os médicos alocados. Pagamentos realizados ou presença registrada impedem esta ação.")
                    "concluir" -> Text("A conclusão encerra candidaturas pendentes e preserva os registros de presença e pagamento.")
                    else -> {
                        if (PlantoesApi.podeEditarOuCancelar(plantao)) {
                            TextButton(onClick = { modo = "editar" }) { Text("Editar") }
                            TextButton(onClick = { modo = "cancelar" }) { Text("Cancelar plantão") }
                        }
                        if (PlantoesApi.podeConcluir(plantao)) TextButton(onClick = { modo = "concluir" }) { Text("Concluir plantão") }
                    }
                }
                if (erro.isNotBlank()) Text(erro, color = MaterialTheme.colorScheme.error)
            }
        },
        confirmButton = { if (modo.isNotEmpty()) TextButton(enabled = !enviando, onClick = { enviar() }) { Text(if (enviando) "Enviando..." else if (modo == "editar") "Salvar" else "Confirmar") } },
        dismissButton = { TextButton(enabled = !enviando, onClick = { if (modo.isEmpty()) onDismiss() else { modo = ""; erro = "" } }) { Text(if (modo.isEmpty()) "Fechar" else "Voltar") } },
    )
}

@Composable
private fun CampoEdicao(rotulo: String, valor: String, atualizar: (String) -> Unit) {
    OutlinedTextField(value = valor, onValueChange = atualizar, label = { Text(rotulo) }, modifier = Modifier.fillMaxWidth(), singleLine = rotulo != "Observações")
}
