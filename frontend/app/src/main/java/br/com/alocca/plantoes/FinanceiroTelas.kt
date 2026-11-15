package br.com.alocca.plantoes

import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp

@Composable
internal fun PagamentosGestorConteudo() {
    val carga = rememberCarga(Unit) { FinanceiroApi.pagamentos(it) }
    var historico by rememberSaveable { mutableStateOf(false) }
    val executor = rememberExecutor()
    val context = LocalContext.current
    var selecionadoId by rememberSaveable { mutableStateOf<String?>(null) }
    var selecionadoNome by rememberSaveable { mutableStateOf("") }
    var selecionadoValor by rememberSaveable { mutableStateOf("") }
    var arquivo by remember { mutableStateOf<ComprovanteArquivo?>(null) }
    var ocupado by remember { mutableStateOf(false) }
    var mensagem by remember { mutableStateOf<String?>(null) }
    val escolher = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
        if (uri != null && selecionadoId != null) {
            ocupado = true
            executor.executar({ FinanceiroApi.lerArquivo(context, uri) }) { r ->
                ocupado = false
                when (r) { is Resposta.Ok -> arquivo = r.dados; is Resposta.Falha -> mensagem = r.mensagem }
            }
        } else selecionadoId = null
    }
    Row {
        FilterChip(selected = !historico, onClick = { historico = false }, label = { Text("Pendentes") })
        FilterChip(selected = historico, onClick = { historico = true }, label = { Text("Histórico de pagos") })
    }
    TextButton(enabled = !ocupado, onClick = { carga.recarregar() }) { Text("Atualizar") }
    mensagem?.let { Text(it) }
    if (ocupado) LinearProgressIndicator(Modifier.fillMaxWidth())
    ConteudoCarga(carga) { pagamentos ->
        val visiveis = pagamentos.filter { (it.status == "PAGO") == historico }
        if (visiveis.isEmpty()) EstadoVazio(if (historico) "Nenhum pagamento realizado." else "Nenhum pagamento pendente.")
        visiveis.forEach { p ->
            key(p.id) {
                Card(Modifier.fillMaxWidth().padding(vertical = 5.dp)) {
                    Column(Modifier.padding(12.dp)) {
                        Text(p.medico)
                        Text("${p.plantao} • ${p.instituicao}")
                        Text(Datas.moeda(p.valor))
                        if (p.status == "PAGO") {
                            Text("Pago em: ${p.pagoEm?.let { Datas.dataCurta(it) } ?: "Data não informada"}")
                            BaixarComprovanteButton(p.id)
                        } else {
                            val vencimentoAtual = p.vencimento
                            Text(
                                when {
                                    vencimentoAtual == null -> "A receber • sem vencimento definido"
                                    vencimentoAtual.before(java.util.Date()) -> "Atrasado desde ${Datas.dataCurta(vencimentoAtual)}"
                                    else -> "A receber • vence em ${Datas.dataCurta(vencimentoAtual)}"
                                }
                            )
                            TextButton(enabled = !ocupado, onClick = {
                                val (anoHoje, mesHoje, diaHoje) = vencimentoAtual?.let {
                                    val cal = java.util.Calendar.getInstance(Datas.fuso).apply { time = it }
                                    Triple(cal.get(java.util.Calendar.YEAR), cal.get(java.util.Calendar.MONTH), cal.get(java.util.Calendar.DAY_OF_MONTH))
                                } ?: java.util.Calendar.getInstance(Datas.fuso).let {
                                    Triple(it.get(java.util.Calendar.YEAR), it.get(java.util.Calendar.MONTH), it.get(java.util.Calendar.DAY_OF_MONTH))
                                }
                                android.app.DatePickerDialog(context, { _, ano, mes, dia ->
                                    val escolhido = FinanceiroCliente.fimDoDiaSelecionado(ano, mes, dia)
                                    ocupado = true
                                    executor.executar({ FinanceiroApi.definirVencimento(it, p.id, escolhido) }) { r ->
                                        ocupado = false
                                        mensagem = when (r) { is Resposta.Ok -> r.dados; is Resposta.Falha -> r.mensagem }
                                        carga.recarregar()
                                    }
                                }, anoHoje, mesHoje, diaHoje).show()
                            }) { Text("Definir vencimento") }
                            if (p.vencimento != null) TextButton(enabled = !ocupado, onClick = {
                                ocupado = true
                                executor.executar({ FinanceiroApi.definirVencimento(it, p.id, null) }) { r ->
                                    ocupado = false
                                    mensagem = when (r) { is Resposta.Ok -> r.dados; is Resposta.Falha -> r.mensagem }
                                    carga.recarregar()
                                }
                            }) { Text("Remover vencimento") }
                            if (!p.encerrado) Text("Baixa disponível após o encerramento do plantão.")
                            Button(enabled = p.encerrado && !ocupado && arquivo == null, onClick = {
                                selecionadoId = p.id; selecionadoNome = p.medico; selecionadoValor = Datas.moeda(p.valor); mensagem = null
                                escolher.launch(arrayOf("application/pdf", "image/jpeg", "image/png"))
                            }) { Text("Anexar comprovante e dar baixa") }
                        }
                    }
                }
            }
        }
    }
    val confirmadoId = selecionadoId
    val anexo = arquivo
    if (confirmadoId != null && anexo != null) AlertDialog(
        onDismissRequest = { if (!ocupado) { arquivo = null; selecionadoId = null } },
        title = { Text("Confirmar baixa") },
        text = { Text("Registrar $selecionadoValor como pago para $selecionadoNome, com ${anexo.nome}?") },
        confirmButton = {
            TextButton(enabled = !ocupado, onClick = {
                ocupado = true
                executor.executar({ FinanceiroApi.darBaixa(it, confirmadoId, anexo) }) { r ->
                    ocupado = false
                    arquivo = null; selecionadoId = null
                    mensagem = when (r) { is Resposta.Ok -> r.dados; is Resposta.Falha -> r.mensagem }
                    carga.recarregar()
                }
            }) { Text("Confirmar pagamento") }
        },
        dismissButton = { TextButton(enabled = !ocupado, onClick = { arquivo = null; selecionadoId = null }) { Text("Cancelar") } },
    )
}

@Composable
internal fun BaixarComprovanteButton(pagamentoId: String) {
    val executor = rememberExecutor()
    val context = LocalContext.current
    var ocupado by remember { mutableStateOf(false) }
    // Bytes apenas em memória. Após recriação, busca autenticada no retorno do seletor.
    var arquivo by remember { mutableStateOf<ComprovanteArquivo?>(null) }
    var escolhendoDestino by rememberSaveable(pagamentoId) { mutableStateOf(false) }
    var mensagem by remember { mutableStateOf<String?>(null) }
    val salvar = rememberLauncherForActivityResult(ActivityResultContracts.CreateDocument("*/*")) { uri ->
        val preparado = arquivo
        arquivo = null
        escolhendoDestino = false
        if (uri != null) {
            ocupado = true
            executor.executar({ token ->
                ComprovanteDownload.salvar(preparado,
                    obter = { FinanceiroApi.baixar(token, pagamentoId) },
                    abrirDestino = { context.contentResolver.openOutputStream(uri) },
                )
            }) { r ->
                ocupado = false
                mensagem = when (r) {
                    is Resposta.Ok -> "Comprovante salvo."
                    is Resposta.Falha -> r.mensagem
                }
            }
        }
    }
    TextButton(enabled = !ocupado && !escolhendoDestino, onClick = {
        ocupado = true; mensagem = null
        executor.executar({ FinanceiroApi.baixar(it, pagamentoId) }) { r ->
            ocupado = false
            when (r) {
                is Resposta.Ok -> {
                    arquivo = r.dados
                    escolhendoDestino = true
                    salvar.launch(r.dados.nome)
                }
                is Resposta.Falha -> mensagem = r.mensagem
            }
        }
    }) { Text(if (ocupado) "Baixando…" else "Baixar comprovante") }
    mensagem?.let { Text(it) }
}
