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
    val carga = rememberCarga(Unit) { FinanceiroApi.pendentes(it) }
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
    Text("Plantões encerrados aguardando baixa")
    TextButton(enabled = !ocupado, onClick = { carga.recarregar() }) { Text("Atualizar") }
    mensagem?.let { Text(it) }
    if (ocupado) LinearProgressIndicator(Modifier.fillMaxWidth())
    ConteudoCarga(carga) { pagamentos ->
        if (pagamentos.isEmpty()) EstadoVazio("Nenhum pagamento elegível para baixa.")
        pagamentos.forEach { p ->
            Card(Modifier.fillMaxWidth().padding(vertical = 5.dp)) {
                Column(Modifier.padding(12.dp)) {
                    Text(p.medico)
                    Text("${p.plantao} • ${p.instituicao}")
                    Text(Datas.moeda(p.valor))
                    Button(enabled = !ocupado && arquivo == null, onClick = {
                        selecionadoId = p.id; selecionadoNome = p.medico; selecionadoValor = Datas.moeda(p.valor); mensagem = null
                        escolher.launch(arrayOf("application/pdf", "image/jpeg", "image/png"))
                    }) { Text("Anexar comprovante e dar baixa") }
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
