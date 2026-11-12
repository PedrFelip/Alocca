package br.com.alocca.plantoes

import android.Manifest
import android.annotation.SuppressLint
import android.content.Context
import android.content.pm.PackageManager
import android.location.Location
import android.location.LocationManager
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.AccessTime
import androidx.compose.material.icons.filled.AccountBalanceWallet
import androidx.compose.material.icons.filled.CalendarMonth
import androidx.compose.material.icons.filled.ChevronRight
import androidx.compose.material.icons.filled.EventNote
import androidx.compose.material.icons.filled.FilterList
import androidx.compose.material.icons.filled.Groups
import androidx.compose.material.icons.filled.LocationOff
import androidx.compose.material.icons.filled.LocationOn
import androidx.compose.material.icons.filled.MedicalServices
import androidx.compose.material.icons.filled.PersonOutline
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import androidx.core.content.ContextCompat
import androidx.core.location.LocationManagerCompat
import android.os.CancellationSignal
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeoutOrNull
import org.json.JSONObject
import java.math.BigDecimal
import java.util.Calendar
import java.util.Date
import java.util.Locale
import kotlin.coroutines.resume

// ===========================================================================
// Infra de carregamento: token do TokenStore, chamada fora da main thread e
// sessão encerrada automaticamente quando a API responde 401.
// ===========================================================================

/** Encerra a sessão quando a API recusa o token (fornecido pelo AuthApp). */
internal val LocalSessaoExpirada = staticCompositionLocalOf<() -> Unit> { {} }

internal sealed interface Estado<out T> {
    data object Carregando : Estado<Nothing>
    data class Erro(val mensagem: String) : Estado<Nothing>
    data class Pronto<T>(val dados: T) : Estado<T>
}

internal class Carga<T>(private val estadoAtual: State<Estado<T>>, private val versao: MutableIntState) {
    val estado: Estado<T> get() = estadoAtual.value
    fun recarregar() { versao.intValue++ }
}

private fun <T> chamar(context: Context, bloco: (String) -> Resposta<T>): Resposta<T> {
    val token = TokenStore.read(context) ?: return Resposta.Falha("Sua sessão expirou. Entre novamente.", 401)
    return bloco(token)
}

/** Carrega dados da API sempre que [chaves] mudam ou [Carga.recarregar] é chamado. */
@Composable
internal fun <T> rememberCarga(vararg chaves: Any?, buscar: (String) -> Resposta<T>): Carga<T> {
    val context = LocalContext.current
    val expirar = LocalSessaoExpirada.current
    val versao = remember { mutableIntStateOf(0) }
    val estado = remember { mutableStateOf<Estado<T>>(Estado.Carregando) }
    LaunchedEffect(*chaves, versao.intValue) {
        estado.value = Estado.Carregando
        when (val r = withContext(Dispatchers.IO) { chamar(context, buscar) }) {
            is Resposta.Ok -> estado.value = Estado.Pronto(r.dados)
            is Resposta.Falha -> if (r.sessaoExpirada) expirar() else estado.value = Estado.Erro(r.mensagem)
        }
    }
    return remember { Carga(estado, versao) }
}

/** Executa ações (POST/PATCH) fora da main thread e devolve o resultado na UI. */
internal class Executor(
    private val scope: CoroutineScope,
    private val context: Context,
    private val expirar: () -> Unit,
) {
    fun <T> executar(bloco: (String) -> Resposta<T>, aoTerminar: (Resposta<T>) -> Unit) {
        scope.launch {
            val r = withContext(Dispatchers.IO) { chamar(context, bloco) }
            if (r is Resposta.Falha && r.sessaoExpirada) expirar() else aoTerminar(r)
        }
    }
}

@Composable
internal fun rememberExecutor(): Executor {
    val scope = rememberCoroutineScope()
    val context = LocalContext.current
    val expirar = LocalSessaoExpirada.current
    return remember(scope, context) { Executor(scope, context, expirar) }
}

@Composable
internal fun <T> ConteudoCarga(carga: Carga<T>, conteudo: @Composable (T) -> Unit) {
    when (val estado = carga.estado) {
        Estado.Carregando -> Box(Modifier.fillMaxWidth().padding(vertical = 32.dp), contentAlignment = Alignment.Center) {
            CircularProgressIndicator(color = DeepTeal, modifier = Modifier.size(32.dp))
        }
        is Estado.Erro -> EstadoVazio(estado.mensagem, "Tentar novamente") { carga.recarregar() }
        is Estado.Pronto -> conteudo(estado.dados)
    }
}

@Composable
internal fun EstadoVazio(texto: String, acao: String? = null, onAcao: () -> Unit = {}) {
    Column(
        modifier = Modifier.fillMaxWidth().clip(RoundedCornerShape(10.dp)).background(Color(0xFFF4F8F9)).padding(18.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Text(texto, color = Muted, fontSize = 12.sp, textAlign = TextAlign.Center, lineHeight = 16.sp)
        if (acao != null) {
            Spacer(Modifier.height(8.dp))
            Text(acao, color = DeepTeal, fontSize = 12.sp, fontWeight = FontWeight.Bold, modifier = Modifier.clickable(onClick = onAcao).padding(6.dp))
        }
    }
}

@Composable
private fun Aviso(texto: String, sucesso: Boolean) {
    Text(
        texto,
        color = if (sucesso) Color(0xFF0B7A55) else Color(0xFFB3261E),
        fontSize = 12.sp,
        lineHeight = 16.sp,
        modifier = Modifier.fillMaxWidth().clip(RoundedCornerShape(8.dp))
            .background(if (sucesso) Color(0xFFE3F7EF) else Color(0xFFFFE9ED)).padding(11.dp),
    )
}

// ===========================================================================
// Componentes de plantão.
// ===========================================================================

internal data class StatusVisual(val rotulo: String, val cor: Color, val fundo: Color)

internal fun statusVisual(status: String): StatusVisual = when (status) {
    "CONFIRMADO", "APROVADA" -> StatusVisual("CONFIRMADO", Color(0xFF1381C8), Color(0xFFD7EFFF))
    "PENDENTE" -> StatusVisual("PENDENTE", Color(0xFFE08A0B), Color(0xFFFFECD3))
    "CONCLUIDO", "REALIZADO" -> StatusVisual("CONCLUÍDO", Color(0xFF008872), Color(0xFFD7EFEA))
    "REJEITADA" -> StatusVisual("NÃO SELECIONADO", Color(0xFFD12F45), Color(0xFFFFE9ED))
    else -> StatusVisual("DISPONÍVEL", Color(0xFF12945F), Color(0xFFE3F7EF))
}

/** Status de uma candidatura considerando a data: aprovada e já encerrada = concluída. */
internal fun Candidatura.statusExibicao(agora: Date = Date()): String =
    if (status == "APROVADA" && plantao.fim.before(agora)) "CONCLUIDO" else status

@Composable
internal fun PlantaoCard(plantao: PlantaoResumo, status: StatusVisual, onClick: () -> Unit) {
    Row(
        modifier = Modifier.fillMaxWidth().clip(RoundedCornerShape(13.dp)).background(Color.White)
            .border(1.dp, Color(0xFFCBD3D4), RoundedCornerShape(13.dp)).clickable(onClick = onClick).padding(10.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(
            modifier = Modifier.width(62.dp).height(80.dp).clip(RoundedCornerShape(12.dp)).background(status.fundo),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.Center,
        ) {
            Text(Datas.dia(plantao.inicio), color = Navy, fontSize = 18.sp, fontWeight = FontWeight.Bold)
            Text(Datas.mesCurto(plantao.inicio), color = Navy, fontSize = 11.sp, fontWeight = FontWeight.Bold)
            Spacer(Modifier.height(5.dp))
            Text("${Datas.semanaCurta(plantao.inicio)} ${Datas.hora(plantao.inicio).removeSuffix(":00")}h", color = Navy, fontSize = 10.sp, fontWeight = FontWeight.Bold)
        }
        Spacer(Modifier.width(10.dp))
        Column(modifier = Modifier.weight(1f)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(status.rotulo, color = status.cor, fontSize = 8.sp, fontWeight = FontWeight.Bold, modifier = Modifier.clip(RoundedCornerShape(4.dp)).background(status.fundo).padding(horizontal = 6.dp, vertical = 2.dp))
                Spacer(Modifier.weight(1f))
                Text(Datas.moeda(plantao.valor), color = Color(0xFF008872), fontSize = 10.sp, fontWeight = FontWeight.Bold, modifier = Modifier.clip(RoundedCornerShape(4.dp)).background(Color(0xFFD7EFEA)).padding(horizontal = 6.dp, vertical = 2.dp))
            }
            Spacer(Modifier.height(4.dp))
            Text(plantao.instituicao.nome, color = Navy, fontSize = 13.sp, fontWeight = FontWeight.Bold, maxLines = 1, overflow = TextOverflow.Ellipsis)
            Text(plantao.especialidade, color = Navy, fontSize = 11.sp, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis)
            Spacer(Modifier.height(3.dp))
            Row(verticalAlignment = Alignment.CenterVertically) {
                Icon(Icons.Default.LocationOn, null, tint = Muted, modifier = Modifier.size(11.dp))
                Text(listOfNotNull(plantao.localUnidade, plantao.instituicao.local.ifBlank { null }).joinToString(" • "), color = Muted, fontSize = 9.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
            Row(verticalAlignment = Alignment.CenterVertically) {
                Icon(Icons.Default.AccessTime, null, tint = Muted, modifier = Modifier.size(11.dp))
                Text(Datas.horario(plantao.inicio, plantao.fim), color = Muted, fontSize = 9.sp)
            }
        }
        Icon(Icons.Default.ChevronRight, contentDescription = "Abrir plantão", tint = Muted, modifier = Modifier.size(20.dp))
    }
}

/** Ação principal do diálogo de detalhes (ex.: candidatar-se). */
internal data class AcaoPlantao(
    val rotulo: String,
    val habilitada: Boolean,
    val motivo: String? = null,
    val carregando: Boolean = false,
    val onClick: () -> Unit,
)

@Composable
internal fun PlantaoDetalhesDialog(
    plantao: PlantaoResumo,
    status: StatusVisual,
    onDismiss: () -> Unit,
    acao: AcaoPlantao? = null,
    mensagem: Pair<String, Boolean>? = null,
) {
    Dialog(onDismissRequest = onDismiss, properties = DialogProperties(usePlatformDefaultWidth = false)) {
        Surface(modifier = Modifier.fillMaxWidth().padding(20.dp), shape = RoundedCornerShape(20.dp), color = Color.White, shadowElevation = 12.dp) {
            Column(modifier = Modifier.verticalScroll(rememberScrollState()).padding(24.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Column(modifier = Modifier.weight(1f)) {
                        Text("Detalhes do plantão", color = Navy, fontSize = 20.sp, fontWeight = FontWeight.Bold)
                        Spacer(Modifier.height(4.dp))
                        Text(Datas.diaPorExtenso(plantao.inicio), color = Muted, fontSize = 13.sp)
                    }
                    Text(status.rotulo, color = status.cor, fontSize = 10.sp, fontWeight = FontWeight.Bold, modifier = Modifier.clip(RoundedCornerShape(6.dp)).background(status.fundo).padding(horizontal = 9.dp, vertical = 6.dp))
                }
                Spacer(Modifier.height(20.dp))
                Text(plantao.instituicao.nome, color = Navy, fontSize = 18.sp, fontWeight = FontWeight.Bold)
                Spacer(Modifier.height(2.dp))
                Text(plantao.titulo, color = Muted, fontSize = 13.sp)
                Spacer(Modifier.height(18.dp))
                DetailLine(Icons.Default.MedicalServices, "Especialidade", plantao.especialidade)
                Spacer(Modifier.height(12.dp))
                DetailLine(Icons.Default.LocationOn, "Local", listOfNotNull(plantao.localUnidade, plantao.instituicao.local.ifBlank { null }).joinToString("\n"))
                Spacer(Modifier.height(12.dp))
                DetailLine(Icons.Default.AccessTime, "Horário", "${Datas.dataCurta(plantao.inicio)} • ${Datas.horario(plantao.inicio, plantao.fim)}")
                Spacer(Modifier.height(12.dp))
                DetailLine(Icons.Default.AccountBalanceWallet, "Valor do plantão", Datas.moeda(plantao.valor), Color(0xFF008872))
                if (plantao.vagasDisponiveis != null && plantao.quantidadeVagas != null) {
                    Spacer(Modifier.height(12.dp))
                    DetailLine(Icons.Default.Groups, "Vagas", "${plantao.vagasDisponiveis} de ${plantao.quantidadeVagas} disponíveis")
                }
                if (!plantao.descricao.isNullOrBlank()) {
                    Spacer(Modifier.height(12.dp))
                    Text(plantao.descricao, color = Muted, fontSize = 12.sp, lineHeight = 16.sp)
                }
                if (mensagem != null) {
                    Spacer(Modifier.height(16.dp))
                    Aviso(mensagem.first, mensagem.second)
                }
                Spacer(Modifier.height(20.dp))
                if (acao != null) {
                    if (!acao.habilitada && acao.motivo != null) {
                        Text(acao.motivo, color = Muted, fontSize = 11.sp, lineHeight = 15.sp)
                        Spacer(Modifier.height(8.dp))
                    }
                    Button(
                        onClick = acao.onClick,
                        enabled = acao.habilitada && !acao.carregando,
                        modifier = Modifier.fillMaxWidth().height(48.dp),
                        colors = ButtonDefaults.buttonColors(containerColor = DeepTeal),
                        shape = RoundedCornerShape(10.dp),
                    ) {
                        if (acao.carregando) CircularProgressIndicator(color = Color.White, strokeWidth = 2.dp, modifier = Modifier.size(20.dp))
                        else Text(acao.rotulo, fontWeight = FontWeight.Bold)
                    }
                    Spacer(Modifier.height(8.dp))
                }
                OutlinedButton(onClick = onDismiss, modifier = Modifier.fillMaxWidth().height(46.dp), shape = RoundedCornerShape(10.dp)) {
                    Text("Fechar", color = Navy, fontWeight = FontWeight.Bold)
                }
            }
        }
    }
}

@Composable
private fun BannerValidacao(perfil: PerfilUsuario) {
    val (titulo, texto, cor, fundo) = when (perfil.statusValidacao) {
        "PENDENTE" -> listOf(
            "Cadastro em análise",
            "Você já pode ver os plantões. A candidatura é liberada depois que o seu CRM for validado.",
            Color(0xFF9A5B00), Color(0xFFFFF4E0),
        )
        "REJEITADO" -> listOf(
            "Cadastro não aprovado",
            perfil.motivoRejeicao?.let { "Motivo: $it. Atualize seus dados no perfil para nova análise." }
                ?: "Atualize seus dados no perfil para nova análise.",
            Color(0xFFB3261E), Color(0xFFFFE9ED),
        )
        else -> return
    }
    Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(10.dp)).background(fundo as Color).padding(13.dp)) {
        Text(titulo as String, color = cor as Color, fontSize = 13.sp, fontWeight = FontWeight.Bold)
        Spacer(Modifier.height(3.dp))
        Text(texto as String, color = Navy, fontSize = 11.sp, lineHeight = 15.sp)
    }
}

private fun motivoSemCandidatura(perfil: PerfilUsuario): String? = when (perfil.statusValidacao) {
    "APROVADO" -> null
    "REJEITADO" -> "Seu cadastro não foi aprovado. Atualize seus dados no perfil para nova análise."
    else -> "A candidatura é liberada depois que o seu CRM for validado."
}

// ===========================================================================
// Início.
// ===========================================================================

private data class ResumoInicio(val candidaturas: List<Candidatura>, val financeiro: Financeiro)

@Composable
internal fun InicioConteudo(perfil: PerfilUsuario, onVerPlantoes: () -> Unit, onBuscar: () -> Unit) {
    val carga = rememberCarga(Unit) { token ->
        when (val c = MedicoApi.minhasCandidaturas(token)) {
            is Resposta.Falha -> c
            is Resposta.Ok -> when (val f = MedicoApi.financeiro(token)) {
                is Resposta.Falha -> f
                is Resposta.Ok -> Resposta.Ok(ResumoInicio(c.dados, f.dados))
            }
        }
    }
    var selecionado by remember { mutableStateOf<Candidatura?>(null) }

    BannerValidacao(perfil)
    if (perfil.statusValidacao != "APROVADO") Spacer(Modifier.height(14.dp))
    ConteudoCarga(carga) { resumo ->
        val agora = Date()
        val confirmados = resumo.candidaturas.filter { it.status == "APROVADA" && it.plantao.fim.after(agora) }.sortedBy { it.plantao.inicio }
        val pendentes = resumo.candidaturas.count { it.status == "PENDENTE" }
        Row(
            modifier = Modifier.fillMaxWidth().clip(RoundedCornerShape(9.dp)).background(Color(0xFF004180)).padding(vertical = 12.dp),
            horizontalArrangement = Arrangement.SpaceEvenly,
        ) {
            SummaryItem(Icons.Default.CalendarMonth, Color(0xFF316B9E), confirmados.size.toString(), "Plantões\nconfirmados")
            SummaryItem(Icons.Default.AccessTime, Color(0xFF009A7B), pendentes.toString(), "Candidaturas\npendentes")
            SummaryItem(Icons.Default.AccountBalanceWallet, Color(0xFF7564A9), Datas.moeda(resumo.financeiro.totalRecebido), "Recebidos")
            SummaryItem(Icons.Default.EventNote, Color(0xFFF5A600), Datas.moeda(resumo.financeiro.totalAReceber + resumo.financeiro.totalPendente), "A receber")
        }
        Spacer(Modifier.height(18.dp))
        SectionTitle("Próximos plantões", "Ver todos", onVerPlantoes)
        Spacer(Modifier.height(9.dp))
        if (confirmados.isEmpty()) {
            EstadoVazio("Você não tem plantões confirmados.", "Buscar plantões", onBuscar)
        } else {
            confirmados.take(3).forEach { c ->
                PlantaoCard(c.plantao, statusVisual(c.status)) { selecionado = c }
                Spacer(Modifier.height(8.dp))
            }
        }
    }
    selecionado?.let { c -> PlantaoDetalhesDialog(c.plantao, statusVisual(c.statusExibicao()), onDismiss = { selecionado = null }) }
}

// ===========================================================================
// Buscar: feed com filtros, paginação e candidatura.
// ===========================================================================

@Composable
internal fun BuscarConteudo(perfil: PerfilUsuario) {
    val executor = rememberExecutor()
    var filtros by remember { mutableStateOf(FiltrosFeed()) }
    var rascunho by remember { mutableStateOf(FiltrosFeed()) }
    var filtrosAbertos by remember { mutableStateOf(false) }
    val plantoes = remember { mutableStateListOf<PlantaoResumo>() }
    var carregando by remember { mutableStateOf(true) }
    var erro by remember { mutableStateOf<String?>(null) }
    var fimDaLista by remember { mutableStateOf(false) }
    var versao by remember { mutableIntStateOf(0) }
    var selecionado by remember { mutableStateOf<PlantaoResumo?>(null) }
    var enviando by remember { mutableStateOf(false) }
    var mensagemDialogo by remember { mutableStateOf<Pair<String, Boolean>?>(null) }
    var aviso by remember { mutableStateOf<String?>(null) }

    fun carregar(reiniciar: Boolean) {
        val offset = if (reiniciar) 0 else plantoes.size
        carregando = true
        erro = null
        val filtrosDaBusca = filtros
        executor.executar({ MedicoApi.feed(it, filtrosDaBusca, offset) }) { r ->
            if (filtrosDaBusca != filtros) return@executar // resposta de uma busca antiga
            carregando = false
            when (r) {
                is Resposta.Ok -> {
                    if (reiniciar) plantoes.clear()
                    // Evita duplicar itens caso a lista mude entre páginas.
                    val ids = plantoes.map { it.id }.toSet()
                    plantoes.addAll(r.dados.filter { it.id !in ids })
                    fimDaLista = r.dados.size < MedicoApi.TAMANHO_PAGINA
                }
                is Resposta.Falha -> erro = r.mensagem
            }
        }
    }
    LaunchedEffect(filtros, versao) { carregar(reiniciar = true) }

    Text("Buscar plantões", color = Navy, fontSize = 16.sp, fontWeight = FontWeight.Bold)
    Spacer(Modifier.height(10.dp))
    Row(verticalAlignment = Alignment.CenterVertically) {
        Row(
            modifier = Modifier.clip(RoundedCornerShape(9.dp)).background(if (filtros.ativos > 0) Color(0xFF0785C9) else Color.White)
                .border(1.dp, Color(0xFFDDE5EB), RoundedCornerShape(9.dp)).clickable { rascunho = filtros; filtrosAbertos = !filtrosAbertos }
                .padding(horizontal = 12.dp, vertical = 8.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Icon(Icons.Default.FilterList, null, tint = if (filtros.ativos > 0) Color.White else Navy, modifier = Modifier.size(16.dp))
            Spacer(Modifier.width(5.dp))
            Text(if (filtros.ativos > 0) "Filtros (${filtros.ativos})" else "Filtros", color = if (filtros.ativos > 0) Color.White else Navy, fontSize = 11.sp, fontWeight = FontWeight.Bold)
        }
        if (filtros.ativos > 0) {
            Spacer(Modifier.width(8.dp))
            Text("Limpar filtros", color = DeepTeal, fontSize = 11.sp, fontWeight = FontWeight.Bold, modifier = Modifier.clickable { filtros = FiltrosFeed(); rascunho = FiltrosFeed() }.padding(6.dp))
        }
        Spacer(Modifier.weight(1f))
        Text("Atualizar", color = DeepTeal, fontSize = 11.sp, fontWeight = FontWeight.Bold, modifier = Modifier.clickable { versao++ }.padding(6.dp))
    }
    AnimatedVisibility(filtrosAbertos) {
        Column(Modifier.fillMaxWidth().padding(top = 10.dp).clip(RoundedCornerShape(10.dp)).background(Color(0xFFEAF7FA)).padding(12.dp)) {
            CampoFiltro("Especialidade", rascunho.especialidade) { rascunho = rascunho.copy(especialidade = it) }
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Box(Modifier.weight(2f)) { CampoFiltro("Cidade", rascunho.cidade) { rascunho = rascunho.copy(cidade = it) } }
                Box(Modifier.weight(1f)) { CampoFiltro("UF", rascunho.uf) { rascunho = rascunho.copy(uf = it.take(2).uppercase()) } }
            }
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Box(Modifier.weight(1f)) { CampoFiltro("Valor mín. (R$)", rascunho.valorMin, KeyboardType.Decimal) { rascunho = rascunho.copy(valorMin = it) } }
                Box(Modifier.weight(1f)) { CampoFiltro("Valor máx. (R$)", rascunho.valorMax, KeyboardType.Decimal) { rascunho = rascunho.copy(valorMax = it) } }
            }
            Spacer(Modifier.height(6.dp))
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
                Text("Cancelar", color = Muted, fontSize = 11.sp, fontWeight = FontWeight.Bold, modifier = Modifier.clickable { filtrosAbertos = false }.padding(10.dp))
                Text("Aplicar filtros", color = Color.White, fontSize = 11.sp, fontWeight = FontWeight.Bold, modifier = Modifier.clip(RoundedCornerShape(7.dp)).background(DeepTeal).clickable { filtros = rascunho; filtrosAbertos = false }.padding(horizontal = 13.dp, vertical = 10.dp))
            }
        }
    }
    Spacer(Modifier.height(12.dp))
    aviso?.let { Aviso(it, true); Spacer(Modifier.height(10.dp)) }
    plantoes.forEach { p ->
        PlantaoCard(p, statusVisual("DISPONIVEL")) { selecionado = p; mensagemDialogo = null }
        Spacer(Modifier.height(8.dp))
    }
    when {
        carregando -> Box(Modifier.fillMaxWidth().padding(vertical = 20.dp), contentAlignment = Alignment.Center) { CircularProgressIndicator(color = DeepTeal, modifier = Modifier.size(28.dp)) }
        erro != null -> EstadoVazio(erro!!, "Tentar novamente") { carregar(reiniciar = plantoes.isEmpty()) }
        plantoes.isEmpty() && filtros.ativos > 0 -> EstadoVazio("Nenhum plantão encontrado com esses filtros.", "Limpar filtros") { filtros = FiltrosFeed(); rascunho = FiltrosFeed() }
        plantoes.isEmpty() -> EstadoVazio("Nenhum plantão disponível no momento.")
        !fimDaLista -> OutlinedButton(onClick = { carregar(reiniciar = false) }, modifier = Modifier.fillMaxWidth()) { Text("Carregar mais", color = Navy) }
    }

    selecionado?.let { p ->
        val motivo = motivoSemCandidatura(perfil)
        PlantaoDetalhesDialog(
            plantao = p,
            status = statusVisual("DISPONIVEL"),
            onDismiss = { if (!enviando) selecionado = null },
            mensagem = mensagemDialogo,
            acao = AcaoPlantao(
                rotulo = "Candidatar-se",
                habilitada = motivo == null,
                motivo = motivo,
                carregando = enviando,
            ) {
                if (enviando) return@AcaoPlantao // evita duplo toque
                enviando = true
                mensagemDialogo = null
                executor.executar({ MedicoApi.candidatar(it, p.id) }) { r ->
                    enviando = false
                    when (r) {
                        is Resposta.Ok -> {
                            // O feed não lista plantões já candidatados.
                            plantoes.removeAll { it.id == p.id }
                            selecionado = null
                            aviso = "${r.dados} Acompanhe em Plantões."
                        }
                        is Resposta.Falha -> mensagemDialogo = r.mensagem to false
                    }
                }
            },
        )
    }
}

@Composable
private fun CampoFiltro(rotulo: String, valor: String, teclado: KeyboardType = KeyboardType.Text, onChange: (String) -> Unit) {
    OutlinedTextField(
        value = valor,
        onValueChange = onChange,
        label = { Text(rotulo, fontSize = 11.sp) },
        singleLine = true,
        keyboardOptions = KeyboardOptions(keyboardType = teclado),
        textStyle = androidx.compose.ui.text.TextStyle(fontSize = 12.sp, color = Navy),
        modifier = Modifier.fillMaxWidth().padding(bottom = 6.dp),
        colors = OutlinedTextFieldDefaults.colors(focusedBorderColor = DeepTeal, unfocusedBorderColor = Color(0xFF93C8D1), focusedLabelColor = DeepTeal),
    )
}

// ===========================================================================
// Meus plantões (candidaturas agrupadas por status).
// ===========================================================================

@Composable
internal fun MeusPlantoesConteudo(onBuscar: () -> Unit) {
    val carga = rememberCarga(Unit) { MedicoApi.minhasCandidaturas(it) }
    var grupo by remember { mutableStateOf("CONFIRMADO") }
    var selecionado by remember { mutableStateOf<Candidatura?>(null) }
    val grupos = listOf("CONFIRMADO" to "Confirmados", "PENDENTE" to "Pendentes", "CONCLUIDO" to "Realizados", "REJEITADA" to "Não selecionados")

    Row(verticalAlignment = Alignment.CenterVertically) {
        Text("Meus plantões", color = Navy, fontSize = 16.sp, fontWeight = FontWeight.Bold)
        Spacer(Modifier.weight(1f))
        Text("Atualizar", color = DeepTeal, fontSize = 11.sp, fontWeight = FontWeight.Bold, modifier = Modifier.clickable { carga.recarregar() }.padding(6.dp))
    }
    Spacer(Modifier.height(10.dp))
    ConteudoCarga(carga) { candidaturas ->
        val porGrupo = candidaturas.groupBy { c -> c.statusExibicao().let { if (it == "APROVADA") "CONFIRMADO" else it } }
        Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            grupos.forEach { (chave, rotulo) ->
                val ativo = grupo == chave
                Text(
                    "$rotulo (${porGrupo[chave]?.size ?: 0})",
                    color = if (ativo) Color.White else Color(0xFF45617D),
                    fontSize = 10.sp,
                    fontWeight = if (ativo) FontWeight.Bold else FontWeight.Normal,
                    modifier = Modifier.clip(RoundedCornerShape(9.dp)).background(if (ativo) Color(0xFF0785C9) else Color.White)
                        .border(1.dp, Color(0xFFDDE5EB), RoundedCornerShape(9.dp)).clickable { grupo = chave }.padding(horizontal = 11.dp, vertical = 7.dp),
                )
            }
        }
        Spacer(Modifier.height(12.dp))
        val lista = (porGrupo[grupo] ?: emptyList()).let { l -> if (grupo == "CONCLUIDO") l.sortedByDescending { it.plantao.inicio } else l.sortedBy { it.plantao.inicio } }
        if (lista.isEmpty()) {
            if (candidaturas.isEmpty()) EstadoVazio("Você ainda não se candidatou a nenhum plantão.", "Buscar plantões", onBuscar)
            else EstadoVazio("Nenhum plantão neste grupo.")
        }
        lista.forEach { c ->
            PlantaoCard(c.plantao, statusVisual(c.statusExibicao())) { selecionado = c }
            Spacer(Modifier.height(8.dp))
        }
    }
    selecionado?.let { c -> PlantaoDetalhesDialog(c.plantao, statusVisual(c.statusExibicao()), onDismiss = { selecionado = null }) }
}

// ===========================================================================
// Agenda (UC09): calendário mensal e lista.
// ===========================================================================

private val CorConfirmado = Color(0xFF006EC6)
private val CorPendente = Color(0xFFF49A19)
private val CorConcluido = Color(0xFF18B66D)

private fun corDoStatus(status: String) = when (status) {
    "CONFIRMADO" -> CorConfirmado
    "PENDENTE" -> CorPendente
    else -> CorConcluido
}

@Composable
internal fun CalendarScreen(onBack: () -> Unit, onTabSelected: (String) -> Unit) {
    val hoje = remember { Calendar.getInstance(Datas.fuso) }
    var ano by remember { mutableIntStateOf(hoje.get(Calendar.YEAR)) }
    var mes by remember { mutableIntStateOf(hoje.get(Calendar.MONTH) + 1) } // 1..12
    var visao by remember { mutableStateOf("Calendário") }
    var diaSelecionado by remember { mutableStateOf<String?>(null) }
    var selecionado by remember { mutableStateOf<ItemAgenda?>(null) }
    val carga = rememberCarga(ano, mes) { MedicoApi.agendaMes(it, ano, mes) }

    fun mudarMes(delta: Int) {
        val c = Calendar.getInstance(Datas.fuso).apply { set(ano, mes - 1, 1); add(Calendar.MONTH, delta) }
        ano = c.get(Calendar.YEAR); mes = c.get(Calendar.MONTH) + 1
        diaSelecionado = null
    }

    Surface(modifier = Modifier.fillMaxSize(), color = Color.White) {
        Column(modifier = Modifier.fillMaxSize().statusBarsPadding().navigationBarsPadding()) {
            QuickActionHeader("Meu calendário", onBack)
            Column(modifier = Modifier.weight(1f).verticalScroll(rememberScrollState()).padding(horizontal = 16.dp)) {
                Spacer(Modifier.height(17.dp))
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Column(Modifier.weight(1f)) {
                        Text("Sua agenda", color = Navy, fontSize = 17.sp, fontWeight = FontWeight.Bold)
                        Text("Plantões confirmados, pendentes e concluídos.", color = Muted, fontSize = 12.sp)
                    }
                }
                Spacer(Modifier.height(12.dp))
                Row(Modifier.fillMaxWidth().clip(RoundedCornerShape(9.dp)).background(Color(0xFFEFF4F6)).padding(3.dp)) {
                    listOf("Calendário", "Lista").forEach { opcao ->
                        Text(
                            opcao,
                            color = if (visao == opcao) Navy else Muted,
                            fontSize = 12.sp,
                            fontWeight = if (visao == opcao) FontWeight.Bold else FontWeight.Normal,
                            textAlign = TextAlign.Center,
                            modifier = Modifier.weight(1f).clip(RoundedCornerShape(7.dp)).background(if (visao == opcao) Color.White else Color.Transparent).clickable { visao = opcao }.padding(vertical = 7.dp),
                        )
                    }
                }
                Spacer(Modifier.height(12.dp))
                val dias = (carga.estado as? Estado.Pronto)?.dados.orEmpty()
                CalendarioMes(
                    ano = ano,
                    mes = mes,
                    dias = dias,
                    mostrarGrade = visao == "Calendário",
                    diaSelecionado = diaSelecionado,
                    onSelecionar = { diaSelecionado = it },
                    onMudarMes = ::mudarMes,
                )
                Spacer(Modifier.height(12.dp))
                ConteudoCarga(carga) { agenda ->
                    if (visao == "Calendário") {
                        val chave = diaSelecionado
                            ?: Datas.chaveDia(Date()).takeIf { c -> c.startsWith(String.format(Locale.ROOT, "%04d-%02d", ano, mes)) }
                            ?: agenda.firstOrNull()?.dia
                        if (chave == null) {
                            EstadoVazio("Nenhum plantão neste mês.", "Buscar plantões") { onTabSelected("Buscar") }
                        } else {
                            val itens = agenda.firstOrNull { it.dia == chave }?.itens.orEmpty()
                            Text(Datas.parseIso("${chave}T12:00:00.000Z")?.let(Datas::diaPorExtenso) ?: chave, color = Muted, fontSize = 12.sp)
                            Spacer(Modifier.height(7.dp))
                            if (itens.isEmpty()) EstadoVazio("Nenhum plantão neste dia.")
                            itens.forEach { item ->
                                PlantaoCard(item.plantao, statusVisual(item.status)) { selecionado = item }
                                Spacer(Modifier.height(7.dp))
                            }
                        }
                    } else {
                        if (agenda.isEmpty()) EstadoVazio("Nenhum plantão neste mês.", "Buscar plantões") { onTabSelected("Buscar") }
                        agenda.forEach { dia ->
                            Text(Datas.parseIso("${dia.dia}T12:00:00.000Z")?.let(Datas::diaPorExtenso) ?: dia.dia, color = Navy, fontSize = 12.sp, fontWeight = FontWeight.Bold)
                            Spacer(Modifier.height(6.dp))
                            dia.itens.forEach { item ->
                                PlantaoCard(item.plantao, statusVisual(item.status)) { selecionado = item }
                                Spacer(Modifier.height(7.dp))
                            }
                            Spacer(Modifier.height(6.dp))
                        }
                    }
                }
                Spacer(Modifier.height(10.dp))
                Row(modifier = Modifier.fillMaxWidth().clip(RoundedCornerShape(9.dp)).background(Color(0xFFD9F3FC)).padding(12.dp), verticalAlignment = Alignment.CenterVertically) {
                    Column(modifier = Modifier.weight(1f)) {
                        Text("Procurando um novo plantão?", color = Navy, fontSize = 12.sp, fontWeight = FontWeight.Bold)
                        Text("Veja as vagas abertas", color = Navy, fontSize = 10.sp)
                    }
                    Text("Buscar plantões", color = Color(0xFF006EC6), fontSize = 10.sp, fontWeight = FontWeight.Bold, modifier = Modifier.clickable { onTabSelected("Buscar") })
                }
                Spacer(Modifier.height(20.dp))
            }
            HomeBottomNavigation("Plantões", onSelected = onTabSelected)
        }
        selecionado?.let { PlantaoDetalhesDialog(it.plantao, statusVisual(it.status), onDismiss = { selecionado = null }) }
    }
}

@Composable
private fun CalendarioMes(
    ano: Int,
    mes: Int,
    dias: List<DiaAgenda>,
    mostrarGrade: Boolean,
    diaSelecionado: String?,
    onSelecionar: (String) -> Unit,
    onMudarMes: (Int) -> Unit,
) {
    val brasil = Locale("pt", "BR")
    val inicio = Calendar.getInstance(Datas.fuso).apply { clear(); set(ano, mes - 1, 1) }
    val primeiroDia = inicio.get(Calendar.DAY_OF_WEEK) - Calendar.SUNDAY
    val diasNoMes = inicio.getActualMaximum(Calendar.DAY_OF_MONTH)
    val nomeMes = inicio.getDisplayName(Calendar.MONTH, Calendar.LONG, brasil).orEmpty().replaceFirstChar { it.titlecase(brasil) }
    val hoje = Datas.chaveDia(Date())
    val porDia = dias.associateBy { it.dia }
    fun chave(dia: Int) = String.format(Locale.ROOT, "%04d-%02d-%02d", ano, mes, dia)

    Column(
        modifier = Modifier.fillMaxWidth().clip(RoundedCornerShape(11.dp)).border(1.dp, Color(0xFFE0E5E5), RoundedCornerShape(11.dp)).padding(15.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text("‹", color = Muted, fontSize = 28.sp, modifier = Modifier.clickable { onMudarMes(-1) }.padding(horizontal = 8.dp))
            Spacer(Modifier.weight(1f))
            Text("$nomeMes $ano", color = Color(0xFF2D3137), fontSize = 14.sp, fontWeight = FontWeight.Bold)
            Spacer(Modifier.weight(1f))
            Text("›", color = Muted, fontSize = 28.sp, modifier = Modifier.clickable { onMudarMes(1) }.padding(horizontal = 8.dp))
        }
        if (mostrarGrade) {
            Spacer(Modifier.height(10.dp))
            val celulas = List(((primeiroDia + diasNoMes + 6) / 7) * 7) { i -> (i - primeiroDia + 1).takeIf { it in 1..diasNoMes } }
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                listOf("D", "S", "T", "Q", "Q", "S", "S").forEach { Text(it, color = Muted, fontSize = 9.sp, textAlign = TextAlign.Center, modifier = Modifier.width(34.dp)) }
            }
            celulas.chunked(7).forEach { semana ->
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                    semana.forEach { dia ->
                        val k = dia?.let(::chave)
                        val itens = k?.let { porDia[it]?.itens }.orEmpty()
                        val selecionado = k != null && k == diaSelecionado
                        Column(
                            modifier = Modifier.width(34.dp).height(38.dp).clip(RoundedCornerShape(8.dp))
                                .background(if (selecionado) Color(0xFFE2F0FF) else Color.Transparent)
                                .then(if (k != null) Modifier.clickable { onSelecionar(k) } else Modifier),
                            horizontalAlignment = Alignment.CenterHorizontally,
                            verticalArrangement = Arrangement.Center,
                        ) {
                            Text(
                                dia?.toString().orEmpty(),
                                color = if (k == hoje) Color(0xFF006EC6) else Color(0xFF2D3137),
                                fontSize = 12.sp,
                                fontWeight = if (selecionado || k == hoje) FontWeight.Bold else FontWeight.Normal,
                            )
                            Row(horizontalArrangement = Arrangement.spacedBy(2.dp), modifier = Modifier.height(5.dp)) {
                                itens.map { it.status }.distinct().take(3).forEach { s ->
                                    Box(Modifier.size(4.dp).clip(CircleShape).background(corDoStatus(s)))
                                }
                            }
                        }
                    }
                }
            }
            Spacer(Modifier.height(10.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                CalendarLegend(CorConfirmado, "Confirmado")
                CalendarLegend(CorPendente, "Pendente")
                CalendarLegend(CorConcluido, "Concluído")
            }
        }
    }
}

// ===========================================================================
// Financeiro (UC08).
// ===========================================================================

@Composable
internal fun FinanceiroConteudo() {
    val carga = rememberCarga(Unit) { MedicoApi.financeiro(it) }
    Row(verticalAlignment = Alignment.CenterVertically) {
        Text("Financeiro", color = Navy, fontSize = 18.sp, fontWeight = FontWeight.Bold)
        Spacer(Modifier.weight(1f))
        Text("Atualizar", color = DeepTeal, fontSize = 11.sp, fontWeight = FontWeight.Bold, modifier = Modifier.clickable { carga.recarregar() }.padding(6.dp))
    }
    Spacer(Modifier.height(12.dp))
    ConteudoCarga(carga) { fin ->
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            ResumoFinanceiro("Recebido", fin.totalRecebido, Color(0xFF008872), Color(0xFFE3F7EF), Modifier.weight(1f))
            ResumoFinanceiro("A receber", fin.totalAReceber, Color(0xFF1381C8), Color(0xFFE2F0FF), Modifier.weight(1f))
            ResumoFinanceiro("Em atraso", fin.totalPendente, Color(0xFFD12F45), Color(0xFFFFE9ED), Modifier.weight(1f))
        }
        Spacer(Modifier.height(18.dp))
        Text("Pagamentos", color = Navy, fontSize = 14.sp, fontWeight = FontWeight.Bold)
        Spacer(Modifier.height(8.dp))
        if (fin.pagamentos.isEmpty()) EstadoVazio("Nenhum pagamento registrado ainda.")
        val agora = Date()
        fin.pagamentos.forEach { p ->
            val vencido = p.status == "PENDENTE" && p.vencimentoEm?.before(agora) == true
            val (rotulo, cor, fundo) = when {
                p.status == "PAGO" -> Triple("Pago${p.pagoEm?.let { " em ${Datas.dataCurta(it)}" }.orEmpty()}", Color(0xFF008872), Color(0xFFE3F7EF))
                vencido -> Triple("Atrasado desde ${Datas.dataCurta(p.vencimentoEm)}", Color(0xFFD12F45), Color(0xFFFFE9ED))
                else -> Triple("Previsto${p.vencimentoEm?.let { " para ${Datas.dataCurta(it)}" }.orEmpty()}", Color(0xFF1381C8), Color(0xFFE2F0FF))
            }
            Row(
                modifier = Modifier.fillMaxWidth().clip(RoundedCornerShape(11.dp)).border(1.dp, Color(0xFFE0E5E5), RoundedCornerShape(11.dp)).padding(12.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Column(Modifier.weight(1f)) {
                    Text(p.instituicao.nome, color = Navy, fontSize = 13.sp, fontWeight = FontWeight.Bold, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    Text("${p.plantaoTitulo} • ${Datas.dataCurta(p.plantaoInicio)}", color = Muted, fontSize = 10.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    Spacer(Modifier.height(5.dp))
                    Text(rotulo, color = cor, fontSize = 9.sp, fontWeight = FontWeight.Bold, modifier = Modifier.clip(RoundedCornerShape(4.dp)).background(fundo).padding(horizontal = 6.dp, vertical = 2.dp))
                }
                Text(Datas.moeda(p.valor), color = Navy, fontSize = 13.sp, fontWeight = FontWeight.Bold)
            }
            Spacer(Modifier.height(8.dp))
        }
    }
}

@Composable
private fun ResumoFinanceiro(titulo: String, valor: BigDecimal, cor: Color, fundo: Color, modifier: Modifier) {
    Column(modifier.clip(RoundedCornerShape(10.dp)).background(fundo).padding(10.dp)) {
        Text(titulo, color = cor, fontSize = 10.sp, fontWeight = FontWeight.Bold)
        Spacer(Modifier.height(4.dp))
        Text(Datas.moeda(valor), color = Navy, fontSize = 12.sp, fontWeight = FontWeight.Bold, maxLines = 1)
    }
}

// ===========================================================================
// Check-in / check-out (UC06) e histórico de ponto.
// ===========================================================================

private data class Presencas(val proximos: List<PresencaProxima>, val historico: List<RegistroPonto>)

@Composable
internal fun WorkplacesScreen(onBack: () -> Unit, onTabSelected: (String) -> Unit) {
    var registro by remember { mutableStateOf<Pair<PresencaProxima, String>?>(null) }
    val carga = rememberCarga(Unit) { token ->
        when (val p = MedicoApi.proximos(token)) {
            is Resposta.Falha -> p
            is Resposta.Ok -> when (val h = MedicoApi.historico(token)) {
                is Resposta.Falha -> h
                is Resposta.Ok -> Resposta.Ok(Presencas(p.dados, h.dados))
            }
        }
    }
    registro?.let { (presenca, tipo) ->
        AttendanceScreen(presenca, tipo, onBack = { registro = null; carga.recarregar() })
        return
    }

    Surface(modifier = Modifier.fillMaxSize(), color = Color.White) {
        Column(modifier = Modifier.fillMaxSize().statusBarsPadding().navigationBarsPadding()) {
            QuickActionHeader("Check-in e check-out", onBack)
            Column(modifier = Modifier.weight(1f).verticalScroll(rememberScrollState()).padding(horizontal = 18.dp)) {
                Spacer(Modifier.height(20.dp))
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Column(Modifier.weight(1f)) {
                        Text("Plantões de hoje", color = Navy, fontSize = 20.sp, fontWeight = FontWeight.Bold)
                        Text("Registre sua presença no horário do plantão.", color = Muted, fontSize = 12.sp, lineHeight = 16.sp)
                    }
                    Text("Atualizar", color = DeepTeal, fontSize = 11.sp, fontWeight = FontWeight.Bold, modifier = Modifier.clickable { carga.recarregar() }.padding(6.dp))
                }
                Spacer(Modifier.height(16.dp))
                ConteudoCarga(carga) { dados ->
                    if (dados.proximos.isEmpty()) EstadoVazio("Nenhum plantão com check-in ou check-out disponível agora.")
                    dados.proximos.forEach { p ->
                        CartaoPresenca(p) { tipo -> registro = p to tipo }
                        Spacer(Modifier.height(12.dp))
                    }
                    Spacer(Modifier.height(10.dp))
                    Row(modifier = Modifier.fillMaxWidth().clip(RoundedCornerShape(10.dp)).background(Color(0xFFE1F3FA)).padding(13.dp), verticalAlignment = Alignment.CenterVertically) {
                        Icon(Icons.Default.LocationOn, null, tint = Cyan, modifier = Modifier.size(22.dp))
                        Spacer(Modifier.width(9.dp))
                        Text("A localização só é usada no momento do registro, quando você toca para confirmar. Nada é rastreado em segundo plano.", color = Navy, fontSize = 11.sp, lineHeight = 14.sp)
                    }
                    Spacer(Modifier.height(20.dp))
                    Text("Registro de ponto", color = Navy, fontSize = 16.sp, fontWeight = FontWeight.Bold)
                    Spacer(Modifier.height(8.dp))
                    if (dados.historico.isEmpty()) EstadoVazio("Você ainda não tem registros de ponto.")
                    // Entrada e saída do mesmo plantão ficam juntas (mesma alocação).
                    dados.historico.groupBy { it.alocacaoId }.values.forEach { registros ->
                        HistoricoPonto(registros)
                        Spacer(Modifier.height(8.dp))
                    }
                }
                Spacer(Modifier.height(16.dp))
            }
            HomeBottomNavigation("Plantões", onSelected = onTabSelected)
        }
    }
}

@Composable
private fun CartaoPresenca(p: PresencaProxima, onRegistrar: (String) -> Unit) {
    data class Situacao(val titulo: String, val acao: String?, val cor: Color, val tipo: String?)
    val (titulo, acao, cor, tipo) = when {
        p.podeFazerCheckin -> Situacao("Check-in disponível", "Realizar check-in", Color(0xFF10A76A), "ENTRADA")
        p.podeFazerCheckout -> Situacao("Check-out disponível", "Realizar check-out", Color(0xFFE42C45), "SAIDA")
        p.checkinFeito -> Situacao("Check-in realizado", null, Color(0xFF1381C8), null)
        else -> Situacao("Check-in liberado às ${p.checkinLiberadoEm?.let(Datas::hora) ?: "--"}", null, Muted, null)
    }
    Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(14.dp)).border(1.dp, Color(0xFFDCE5E8), RoundedCornerShape(14.dp)).padding(15.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Box(Modifier.size(40.dp).clip(RoundedCornerShape(10.dp)).background(cor.copy(alpha = 0.12f)), contentAlignment = Alignment.Center) {
                Icon(if (tipo == "SAIDA") Icons.Default.AccessTime else Icons.Default.EventNote, null, tint = cor, modifier = Modifier.size(22.dp))
            }
            Spacer(Modifier.width(11.dp))
            Column(Modifier.weight(1f)) {
                Text(p.plantao.instituicao.nome, color = Navy, fontSize = 14.sp, fontWeight = FontWeight.Bold)
                Text("${p.plantao.especialidade} • ${p.plantao.localUnidade.orEmpty()}", color = Muted, fontSize = 10.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
        }
        Spacer(Modifier.height(10.dp))
        HorizontalDivider(color = Color(0xFFE6ECEE))
        Spacer(Modifier.height(10.dp))
        Text(titulo.uppercase(), color = cor, fontSize = 10.sp, fontWeight = FontWeight.Bold)
        Spacer(Modifier.height(3.dp))
        Text("${Datas.dataCurta(p.plantao.inicio)} • ${Datas.horario(p.plantao.inicio, p.plantao.fim)}", color = Muted, fontSize = 11.sp)
        if (p.podeFazerCheckout && p.checkoutAte != null) Text("Check-out até ${Datas.hora(p.checkoutAte)}", color = Muted, fontSize = 10.sp)
        if (acao != null && tipo != null) {
            Spacer(Modifier.height(12.dp))
            Button(onClick = { onRegistrar(tipo) }, modifier = Modifier.fillMaxWidth().height(43.dp), shape = RoundedCornerShape(8.dp), colors = ButtonDefaults.buttonColors(containerColor = cor)) {
                Text(acao, color = Color.White, fontSize = 12.sp, fontWeight = FontWeight.Bold)
            }
        }
    }
}

@Composable
private fun HistoricoPonto(registros: List<RegistroPonto>) {
    val primeiro = registros.first()
    Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(11.dp)).border(1.dp, Color(0xFFE0E5E5), RoundedCornerShape(11.dp)).padding(12.dp)) {
        Text(primeiro.instituicao.nome, color = Navy, fontSize = 13.sp, fontWeight = FontWeight.Bold)
        Text(primeiro.plantaoTitulo, color = Muted, fontSize = 10.sp)
        Spacer(Modifier.height(6.dp))
        registros.sortedBy { it.timestamp }.forEach { r ->
            Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.padding(vertical = 2.dp)) {
                Text(if (r.tipoEvento == "ENTRADA") "Entrada" else "Saída", color = if (r.tipoEvento == "ENTRADA") Color(0xFF10A76A) else Color(0xFFE42C45), fontSize = 11.sp, fontWeight = FontWeight.Bold, modifier = Modifier.width(56.dp))
                Text(Datas.dataHora(r.timestamp), color = Navy, fontSize = 11.sp, modifier = Modifier.weight(1f))
                Icon(if (r.comLocalizacao) Icons.Default.LocationOn else Icons.Default.LocationOff, null, tint = Muted, modifier = Modifier.size(13.dp))
                Text(if (r.comLocalizacao) "com local." else "sem local.", color = Muted, fontSize = 9.sp)
            }
        }
    }
}

@Composable
private fun AttendanceScreen(presenca: PresencaProxima, tipoEvento: String, onBack: () -> Unit) {
    val context = LocalContext.current
    val executor = rememberExecutor()
    val scope = rememberCoroutineScope()
    val isCheckIn = tipoEvento == "ENTRADA"
    val accent = if (isCheckIn) Color(0xFF10A76A) else Color(0xFFE42C45)
    var enviando by remember { mutableStateOf(false) }
    var resultado by remember { mutableStateOf<Pair<String, Boolean>?>(null) }
    var concluido by remember { mutableStateOf(false) }
    val plantao = presenca.plantao

    fun registrar(local: Location?) {
        executor.executar({
            MedicoApi.registrarPresenca(it, presenca.alocacaoId, tipoEvento, local?.latitude, local?.longitude, local?.accuracy?.toDouble())
        }) { r ->
            enviando = false
            when (r) {
                is Resposta.Ok -> { resultado = r.dados to true; concluido = true }
                is Resposta.Falha -> resultado = r.mensagem to false
            }
        }
    }

    // Localização só neste toque (LGPD): pede permissão, lê uma posição e envia.
    // Permissão negada ou GPS indisponível = registro sem localização (RN19).
    val permissao = rememberLauncherForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { concedidas ->
        if (concedidas.values.any { it }) {
            scope.launch { registrar(localizacaoAtual(context)) }
        } else {
            registrar(null)
        }
    }

    Surface(modifier = Modifier.fillMaxSize(), color = Color.White) {
        Column(modifier = Modifier.fillMaxSize().statusBarsPadding().navigationBarsPadding()) {
            AttendanceTopBar()
            Column(modifier = Modifier.weight(1f).verticalScroll(rememberScrollState()).padding(horizontal = 18.dp)) {
                Spacer(Modifier.height(17.dp))
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text("‹", color = Navy, fontSize = 30.sp, modifier = Modifier.clickable(enabled = !enviando, onClick = onBack).padding(end = 9.dp))
                    Column {
                        Text(if (isCheckIn) "Check-in" else "Check-out", color = Navy, fontSize = 22.sp, fontWeight = FontWeight.Bold)
                        Text(if (isCheckIn) "Registre sua entrada no plantão" else "Registre sua saída do plantão", color = Color(0xFF6281AC), fontSize = 12.sp)
                    }
                }
                Spacer(Modifier.height(16.dp))
                Column(modifier = Modifier.fillMaxWidth().clip(RoundedCornerShape(10.dp)).border(1.dp, Color(0xFFE0E8EB), RoundedCornerShape(10.dp)).background(Color.White).padding(15.dp)) {
                    Text("Informações do plantão", color = Navy, fontSize = 14.sp, fontWeight = FontWeight.Bold)
                    Spacer(Modifier.height(15.dp))
                    AttendanceDetail("Hospital", plantao.instituicao.nome, Icons.Default.LocationOn)
                    HorizontalDivider(modifier = Modifier.padding(vertical = 11.dp), color = Color(0xFFE8EDF0))
                    AttendanceDetail("Data", Datas.dataCurta(plantao.inicio), Icons.Default.CalendarMonth)
                    HorizontalDivider(modifier = Modifier.padding(vertical = 11.dp), color = Color(0xFFE8EDF0))
                    AttendanceDetail("Horário do plantão", Datas.horario(plantao.inicio, plantao.fim), Icons.Default.AccessTime)
                    HorizontalDivider(modifier = Modifier.padding(vertical = 11.dp), color = Color(0xFFE8EDF0))
                    AttendanceDetail("Especialidade", plantao.especialidade, Icons.Default.MedicalServices)
                    if (plantao.localUnidade != null) {
                        HorizontalDivider(modifier = Modifier.padding(vertical = 11.dp), color = Color(0xFFE8EDF0))
                        AttendanceDetail("Unidade", plantao.localUnidade, Icons.Default.PersonOutline)
                    }
                }
                Spacer(Modifier.height(14.dp))
                Row(modifier = Modifier.fillMaxWidth().clip(RoundedCornerShape(8.dp)).background(Color(0xFFE5F2FF)).padding(12.dp)) {
                    Text("i", color = Color.White, fontSize = 12.sp, fontWeight = FontWeight.Bold, textAlign = TextAlign.Center, modifier = Modifier.size(20.dp).clip(CircleShape).background(Color(0xFF1475D1)).padding(top = 2.dp))
                    Spacer(Modifier.width(10.dp))
                    Text(
                        "O horário registrado é o do servidor. Com localização, guardamos a posição deste registro para conferência do hospital. Sem localização, o registro vale do mesmo jeito.",
                        color = Color(0xFF1B66B4), fontSize = 10.sp, lineHeight = 13.sp, modifier = Modifier.weight(1f),
                    )
                }
                Spacer(Modifier.height(15.dp))
                resultado?.let { (texto, ok) -> Aviso(texto, ok); Spacer(Modifier.height(12.dp)) }
                if (concluido) {
                    Button(onClick = onBack, modifier = Modifier.fillMaxWidth().height(48.dp), shape = RoundedCornerShape(8.dp), colors = ButtonDefaults.buttonColors(containerColor = Navy)) {
                        Text("Voltar", color = Color.White, fontWeight = FontWeight.Bold, fontSize = 12.sp)
                    }
                } else {
                    Button(
                        onClick = {
                            if (enviando) return@Button
                            enviando = true
                            resultado = null
                            permissao.launch(arrayOf(Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION))
                        },
                        enabled = !enviando,
                        modifier = Modifier.fillMaxWidth().height(48.dp),
                        shape = RoundedCornerShape(8.dp),
                        colors = ButtonDefaults.buttonColors(containerColor = accent),
                    ) {
                        if (enviando) CircularProgressIndicator(color = Color.White, strokeWidth = 2.dp, modifier = Modifier.size(20.dp))
                        else Text(if (isCheckIn) "Confirmar check-in com localização" else "Confirmar check-out com localização", color = Color.White, fontWeight = FontWeight.Bold, fontSize = 12.sp)
                    }
                    Spacer(Modifier.height(8.dp))
                    OutlinedButton(
                        onClick = { if (!enviando) { enviando = true; resultado = null; registrar(null) } },
                        enabled = !enviando,
                        modifier = Modifier.fillMaxWidth().height(46.dp),
                        shape = RoundedCornerShape(8.dp),
                    ) { Text("Registrar sem localização", color = Navy, fontSize = 12.sp, fontWeight = FontWeight.Bold) }
                }
                Spacer(Modifier.height(16.dp))
            }
        }
    }
}

/** Uma única leitura de posição, com limite de 10 s. Null quando indisponível. */
@SuppressLint("MissingPermission")
private suspend fun localizacaoAtual(context: Context): Location? {
    val temPermissao = listOf(Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION)
        .any { ContextCompat.checkSelfPermission(context, it) == PackageManager.PERMISSION_GRANTED }
    if (!temPermissao) return null
    val lm = context.getSystemService(Context.LOCATION_SERVICE) as? LocationManager ?: return null
    val provedor = listOf(LocationManager.GPS_PROVIDER, LocationManager.NETWORK_PROVIDER)
        .firstOrNull { runCatching { lm.isProviderEnabled(it) }.getOrDefault(false) } ?: return null
    return withTimeoutOrNull(10_000) {
        suspendCancellableCoroutine { cont ->
            val cancelar = CancellationSignal()
            cont.invokeOnCancellation { cancelar.cancel() }
            runCatching {
                LocationManagerCompat.getCurrentLocation(lm, provedor, cancelar, ContextCompat.getMainExecutor(context)) { local ->
                    if (cont.isActive) cont.resume(local)
                }
            }.onFailure { if (cont.isActive) cont.resume(null) }
        }
    }
}

// ===========================================================================
// Perfil (GET/PATCH /usuarios/me).
// ===========================================================================

@Composable
internal fun ProfileScreen(
    perfil: PerfilUsuario,
    onBack: () -> Unit,
    onTabSelected: (String) -> Unit,
    onPerfilAtualizado: (PerfilUsuario) -> Unit,
) {
    val carga = rememberCarga(Unit) { MedicoApi.perfil(it) }
    val executor = rememberExecutor()
    var editando by remember { mutableStateOf<String?>(null) }
    var salvando by remember { mutableStateOf(false) }
    var mensagem by remember { mutableStateOf<Pair<String, Boolean>?>(null) }
    var atual by remember { mutableStateOf<PerfilCompleto?>(null) }

    fun salvar(campos: JSONObject) {
        if (campos.length() == 0) { editando = null; return }
        salvando = true
        mensagem = null
        executor.executar({ MedicoApi.atualizarPerfil(it, campos) }) { r ->
            salvando = false
            when (r) {
                is Resposta.Ok -> {
                    atual = r.dados
                    editando = null
                    mensagem = (if (campos.has("crm") || campos.has("uf_crm")) "Dados salvos. Como o CRM mudou, seu cadastro voltou para análise." else "Dados salvos com sucesso.") to true
                    onPerfilAtualizado(perfil.copy(nome = r.dados.nome, crm = r.dados.crm, ufCrm = r.dados.ufCrm, statusValidacao = r.dados.statusValidacao, motivoRejeicao = r.dados.motivoRejeicao))
                }
                is Resposta.Falha -> mensagem = r.mensagem to false
            }
        }
    }

    Surface(modifier = Modifier.fillMaxSize(), color = Color.White) {
        Column(modifier = Modifier.fillMaxSize().statusBarsPadding().navigationBarsPadding()) {
            QuickActionHeader("Meu perfil", onBack)
            Column(modifier = Modifier.weight(1f).verticalScroll(rememberScrollState()).padding(horizontal = 14.dp)) {
                Spacer(Modifier.height(14.dp))
                ConteudoCarga(carga) { carregado ->
                    val dados = atual ?: carregado
                    Row(modifier = Modifier.fillMaxWidth().clip(RoundedCornerShape(11.dp)).background(Color(0xFF083C7A)).padding(13.dp), verticalAlignment = Alignment.CenterVertically) {
                        Box(modifier = Modifier.size(62.dp).clip(CircleShape).background(Color(0xFFD9F3FC)), contentAlignment = Alignment.Center) {
                            Text(iniciais(dados.nome), color = DeepTeal, fontSize = 20.sp, fontWeight = FontWeight.Bold)
                        }
                        Spacer(Modifier.width(14.dp))
                        Column(modifier = Modifier.weight(1f)) {
                            Text(dados.nome, color = Color.White, fontSize = 16.sp, fontWeight = FontWeight.Bold)
                            Spacer(Modifier.height(5.dp))
                            Text("✉ ${dados.email}", color = Color.White, fontSize = 10.sp)
                            if (dados.crm != null) Text("▣ CRM ${dados.crm}-${dados.ufCrm.orEmpty()}", color = Color.White, fontSize = 10.sp)
                            if (dados.cpf != null) Text("♙ CPF ${cpfMascarado(dados.cpf)}", color = Color.White, fontSize = 10.sp)
                        }
                    }
                    Spacer(Modifier.height(12.dp))
                    StatusValidacao(dados)
                    Spacer(Modifier.height(14.dp))
                    mensagem?.let { (texto, ok) -> Aviso(texto, ok); Spacer(Modifier.height(12.dp)) }

                    ProfileSection("Dados pessoais", listOf("Nome" to dados.nome, "E-mail" to dados.email, "Telefone" to (dados.telefone ?: "Não informado")), onEdit = { editando = if (editando == "pessoal") null else "pessoal"; mensagem = null })
                    AnimatedVisibility(editando == "pessoal") {
                        ProfileEditorCard(
                            title = "Editar dados pessoais",
                            fields = listOf("Nome" to dados.nome, "Telefone" to dados.telefone.orEmpty()),
                            saving = salvando,
                            onCancel = { editando = null },
                            onSave = { v ->
                                salvar(JSONObject().apply {
                                    if (v[0].trim() != dados.nome) put("nome", v[0].trim())
                                    if (v[1].trim() != dados.telefone.orEmpty() && v[1].isNotBlank()) put("telefone", v[1].trim())
                                })
                            },
                        )
                    }
                    Spacer(Modifier.height(12.dp))
                    ProfileSection("Dados profissionais", listOf("CRM" to (dados.crm ?: "-"), "UF do CRM" to (dados.ufCrm ?: "-"), "Especialidade" to (dados.especialidade ?: "Não informada")), onEdit = { editando = if (editando == "profissional") null else "profissional"; mensagem = null })
                    AnimatedVisibility(editando == "profissional") {
                        Column {
                            Text("Alterar CRM ou UF envia seu cadastro para nova análise.", color = Color(0xFF9A5B00), fontSize = 10.sp, modifier = Modifier.padding(top = 8.dp))
                            ProfileEditorCard(
                                title = "Editar dados profissionais",
                                fields = listOf("CRM" to dados.crm.orEmpty(), "UF do CRM" to dados.ufCrm.orEmpty(), "Especialidade" to dados.especialidade.orEmpty()),
                                saving = salvando,
                                onCancel = { editando = null },
                                onSave = { v ->
                                    salvar(JSONObject().apply {
                                        if (v[0].trim() != dados.crm.orEmpty()) put("crm", v[0].trim())
                                        if (v[1].trim().uppercase() != dados.ufCrm.orEmpty()) put("uf_crm", v[1].trim().uppercase())
                                        if (v[2].trim() != dados.especialidade.orEmpty() && v[2].isNotBlank()) put("especialidade", v[2].trim())
                                    })
                                },
                            )
                        }
                    }
                    if (dados.especialidade == null) {
                        Spacer(Modifier.height(10.dp))
                        Text("Sem especialidade cadastrada você não consegue se candidatar a plantões.", color = Color(0xFF9A5B00), fontSize = 11.sp, lineHeight = 15.sp)
                    }
                }
                Spacer(Modifier.height(22.dp))
            }
            HomeBottomNavigation("Configurações", onSelected = onTabSelected)
        }
    }
}

@Composable
private fun StatusValidacao(dados: PerfilCompleto) {
    val (rotulo, cor, fundo) = when (dados.statusValidacao) {
        "APROVADO" -> Triple("CRM validado", Color(0xFF087A4D), Color(0xFFE9F8F3))
        "REJEITADO" -> Triple("Cadastro não aprovado", Color(0xFFB3261E), Color(0xFFFFE9ED))
        else -> Triple("CRM em análise", Color(0xFF9A5B00), Color(0xFFFFF4E0))
    }
    Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(10.dp)).background(fundo).padding(12.dp)) {
        Text(rotulo, color = cor, fontSize = 13.sp, fontWeight = FontWeight.Bold)
        if (dados.statusValidacao == "REJEITADO" && dados.motivoRejeicao != null) {
            Text("Motivo: ${dados.motivoRejeicao}", color = Navy, fontSize = 11.sp)
        }
        if (dados.statusValidacao == "PENDENTE") {
            Text("A candidatura a plantões é liberada após a validação.", color = Navy, fontSize = 11.sp)
        }
    }
}

private fun iniciais(nome: String): String =
    nome.split(" ").filter { it.isNotBlank() && !it.endsWith(".") }.take(2).joinToString("") { it.take(1) }.uppercase().ifBlank { "?" }

/** Mostra só os 5 últimos dígitos do CPF. */
private fun cpfMascarado(cpf: String): String =
    if (cpf.length == 11) "•••.•••.${cpf.substring(6, 9)}-${cpf.substring(9)}" else "•••"
