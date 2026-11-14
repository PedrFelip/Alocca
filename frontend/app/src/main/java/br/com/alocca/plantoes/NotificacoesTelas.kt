package br.com.alocca.plantoes

import android.Manifest
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.EventNote
import androidx.compose.material.icons.filled.NotificationsNone
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.Surface
import androidx.compose.material3.Switch
import androidx.compose.material3.SwitchDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.core.content.ContextCompat
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone

/**
 * Destino pendente de um deep link de plantão (push ou inbox), já validado
 * por `DeepLink.validar`. A activity grava; a tela autenticada consome.
 * Limpo no logout para não navegar com destino de outra sessão.
 */
internal object DestinoPlantao {
    private val _plantaoId = MutableStateFlow<String?>(null)
    val plantaoId: StateFlow<String?> = _plantaoId.asStateFlow()

    fun definir(id: String) {
        if (DeepLink.validar(id) != null) _plantaoId.value = DeepLink.validar(id)
    }

    fun consumir() {
        _plantaoId.value = null
    }
}

/**
 * Painel de notificações com inbox real: estados de carregamento, vazio e
 * erro, paginação por cursor, marcar lida (idempotente, sem sucesso falso) e
 * deep link para o plantão correspondente.
 */
@Composable
internal fun NotificationsPanel(onClose: () -> Unit, onAbrirPlantao: (String) -> Unit = {}) {
    val context = LocalContext.current
    val token = remember { TokenStore.read(context) }

    var itens by remember { mutableStateOf<List<NotificacaoInbox>>(emptyList()) }
    var cursorProxima by remember { mutableStateOf<String?>(null) }
    var carregando by remember { mutableStateOf(true) }
    var carregandoMais by remember { mutableStateOf(false) }
    var erro by remember { mutableStateOf("") }
    var rodada by remember { mutableIntStateOf(0) }
    var marcandoLida by remember { mutableStateOf<Set<String>>(emptySet()) }
    var desmontada = remember { mutableStateOf(false) }
    DisposableEffect(Unit) {
        desmontada.value = false
        onDispose { desmontada.value = true }
    }

    fun carregarPagina(cursor: String?) {
        if (token == null) {
            carregando = false
            erro = NOTIFICACAO_MSG_SESSAO_EXPIRADA
            return
        }
        if (cursor == null) carregando = true else carregandoMais = true
        erro = ""
        val rodadaLocal = rodada
        Thread {
            val resultado = runCatching {
                if (cursor == null) Sessao.consultar(context, token) { NotificacoesApi.listar(it) } else Sessao.consultar(context, token) { NotificacoesApi.listar(it, cursor) }
            }.getOrElse { Resposta.Falha(NOTIFICACAO_MSG_FALHA_GENERICA, 0) }
            Handler(Looper.getMainLooper()).post {
                if (desmontada.value || rodadaLocal != rodada || !Sessao.mesmaSessao(token, TokenStore.read(context))) return@post
                carregando = false
                carregandoMais = false
                when (resultado) {
                    is Resposta.Ok -> {
                        val paginaNova = resultado.dados
                        // Entrega é at-least-once: id já visto não entra de novo.
                        val idsExistentes = itens.map(NotificacaoInbox::id).toSet()
                        itens = itens + paginaNova.itens.filter { it.id !in idsExistentes }
                        cursorProxima = paginaNova.nextCursor
                        erro = ""
                    }
                    is Resposta.Falha -> erro = resultado.mensagem
                }
            }
        }.start()
    }

    LaunchedEffect(token, rodada) {
        if (rodada == 0) {
            itens = emptyList()
            cursorProxima = null
        }
        carregarPagina(null)
    }

    fun aoTocar(item: NotificacaoInbox) {
        if (token == null || item.id in marcandoLida) return
        marcandoLida = marcandoLida + item.id
        erro = ""
        val rodadaLocal = rodada
        Thread {
            val resultado = if (item.naoLida) {
                runCatching { Sessao.consultar(context, token) { NotificacoesApi.marcarLida(it, item.id) } }
                    .getOrElse { Resposta.Falha(NOTIFICACAO_MSG_FALHA_GENERICA, 0) }
            } else Resposta.Ok(Unit)
            Handler(Looper.getMainLooper()).post {
                if (desmontada.value || rodadaLocal != rodada || !Sessao.mesmaSessao(token, TokenStore.read(context))) return@post
                marcandoLida = marcandoLida - item.id
                when (resultado) {
                    is Resposta.Ok -> {
                        itens = itens.map { if (it.id == item.id) it.copy(lidaEm = "confirmado") else it }
                        if (item.naoLida) NotificacoesCentral.registrarLeitura()
                        onClose()
                        item.plantaoId?.let(onAbrirPlantao)
                    }
                    is Resposta.Falha -> erro = resultado.mensagem
                }
            }
        }.start()
    }

    Surface(
        modifier = Modifier.width(300.dp),
        shape = RoundedCornerShape(16.dp),
        color = Color.White,
        shadowElevation = 10.dp,
        border = androidx.compose.foundation.BorderStroke(1.dp, Color(0xFFE0E5E5)),
    ) {
        Column(modifier = Modifier.padding(18.dp)) {
            Text("Notificações", color = Navy, fontSize = 17.sp, fontWeight = FontWeight.Bold)
            Spacer(Modifier.height(12.dp))

            when {
                carregando -> Row(
                    modifier = Modifier.fillMaxWidth().padding(vertical = 18.dp),
                    horizontalArrangement = Arrangement.Center,
                ) {
                    CircularProgressIndicator(color = DeepTeal, modifier = Modifier.size(20.dp), strokeWidth = 2.dp)
                    Spacer(Modifier.width(10.dp))
                    Text("Carregando notificações…", color = Muted, fontSize = 12.sp)
                }
                erro.isNotBlank() -> Column {
                    Text(erro, color = Color(0xFFB3261E), fontSize = 12.sp)
                    Spacer(Modifier.height(8.dp))
                    Text(
                        "Tentar novamente",
                        Modifier.clickable { rodada++ }.padding(4.dp),
                        color = DeepTeal,
                        fontSize = 13.sp,
                        fontWeight = FontWeight.Bold,
                    )
                }
                itens.isEmpty() -> Text(
                    "Você não tem notificações.",
                    color = Muted,
                    fontSize = 12.sp,
                    modifier = Modifier.padding(vertical = 8.dp),
                )
                else -> Column {
                    itens.forEach { item ->
                        InboxLinha(item, ocupado = item.id in marcandoLida) { aoTocar(item) }
                        Spacer(Modifier.height(10.dp))
                    }
                    if (cursorProxima != null) {
                        Text(
                            if (carregandoMais) "Carregando…" else "Carregar mais",
                            color = Cyan,
                            fontSize = 12.sp,
                            fontWeight = FontWeight.Bold,
                            modifier = Modifier
                                .fillMaxWidth()
                                .clickable(enabled = !carregandoMais) { carregarPagina(cursorProxima) }
                                .padding(vertical = 6.dp),
                            textAlign = androidx.compose.ui.text.style.TextAlign.Center,
                        )
                    }
                }
            }

            Spacer(Modifier.height(8.dp))
            Text(
                "Fechar",
                color = DeepTeal,
                fontSize = 13.sp,
                fontWeight = FontWeight.Bold,
                modifier = Modifier.align(Alignment.End).clickable(onClick = onClose).padding(5.dp),
            )
        }
    }
}

@Composable
private fun InboxLinha(item: NotificacaoInbox, ocupado: Boolean, onClick: () -> Unit) {
    Row(
        modifier = Modifier.fillMaxWidth().clickable(enabled = !ocupado, onClick = onClick),
        verticalAlignment = Alignment.Top,
    ) {
        Box(
            modifier = Modifier.size(34.dp).clip(RoundedCornerShape(9.dp)).background(Color(0xFFE1F3F4)),
            contentAlignment = Alignment.Center,
        ) {
            Icon(Icons.Default.EventNote, contentDescription = null, tint = DeepTeal, modifier = Modifier.size(19.dp))
        }
        Spacer(Modifier.width(10.dp))
        Column(modifier = Modifier.weight(1f)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                if (item.naoLida) {
                    // Ponto de não lida, alinhado ao título.
                    Box(
                        modifier = Modifier
                            .size(7.dp)
                            .clip(androidx.compose.foundation.shape.CircleShape)
                            .background(Cyan),
                    )
                    Spacer(Modifier.width(6.dp))
                }
                Text(
                    NotificadorLocal.tituloDoTipo(item.tipo),
                    color = Navy,
                    fontSize = 13.sp,
                    fontWeight = if (item.naoLida) FontWeight.Bold else FontWeight.SemiBold,
                )
            }
            Spacer(Modifier.height(2.dp))
            Text(
                formatarQuando(item.criadaEm),
                color = Muted,
                fontSize = 11.sp,
                lineHeight = 14.sp,
            )
        }
        if (ocupado) {
            CircularProgressIndicator(
                color = DeepTeal,
                modifier = Modifier.size(14.dp),
                strokeWidth = 2.dp,
            )
        }
    }
}

/** ISO do servidor ("…Z") para "dd/MM HH:mm" no fuso local; fallback: string crua. */
internal fun formatarQuando(iso: String): String {
    if (iso.isBlank()) return ""
    return runCatching {
        val parser = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss'Z'", Locale.US).apply {
            timeZone = TimeZone.getTimeZone("UTC")
            isLenient = false
        }
        val instante = parser.parse(iso) ?: error("formato")
        SimpleDateFormat("dd/MM HH:mm", Locale.getDefault()).format(instante as Date)
    }.getOrElse { iso }
}

/**
 * Preferências de notificação por canal (push/e-mail), com persistência real:
 * erro de rede ou de servidor reverte o switch e mostra a mensagem — nunca
 * sucesso falso. Ao ativar push no Android 13+, pede POST_NOTIFICATIONS.
 */
@Composable
internal fun PreferenciasNotificacaoSecao(modifier: Modifier = Modifier) {
    val context = LocalContext.current
    val token = remember { TokenStore.read(context) }

    var carregando by remember { mutableStateOf(token != null) }
    var push by remember { mutableStateOf(false) }
    var email by remember { mutableStateOf(false) }
    var salvando by remember { mutableStateOf(false) }
    var erro by remember { mutableStateOf("") }
    var rodada by remember { mutableIntStateOf(0) }
    var desmontada = remember { mutableStateOf(false) }
    DisposableEffect(Unit) {
        desmontada.value = false
        onDispose { desmontada.value = true }
    }

    val pedirPermissao = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestPermission(),
    ) { }

    LaunchedEffect(token, rodada) {
        if (token == null) {
            carregando = false
            erro = NOTIFICACAO_MSG_SESSAO_EXPIRADA
            return@LaunchedEffect
        }
        carregando = true
        erro = ""
        val rodadaLocal = rodada
        Thread {
            val resultado = runCatching { Sessao.consultar(context, token) { NotificacoesApi.preferencias(it) } }
                .getOrElse { Resposta.Falha(NOTIFICACAO_MSG_FALHA_GENERICA, 0) }
            Handler(Looper.getMainLooper()).post {
                if (desmontada.value || rodadaLocal != rodada || !Sessao.mesmaSessao(token, TokenStore.read(context))) return@post
                carregando = false
                when (resultado) {
                    is Resposta.Ok -> {
                        push = resultado.dados.push
                        email = resultado.dados.email
                    }
                    is Resposta.Falha -> erro = resultado.mensagem
                }
            }
        }.start()
    }

    /** Revogação: devolve o valor anterior para o switch voltar se falhar. */
    fun salvar(preferencias: PreferenciasNotificacao, anterior: PreferenciasNotificacao) {
        if (token == null || salvando) return
        salvando = true
        PreferenciasLocais.iniciarAlteracao()
        erro = ""
        Thread {
            val resultado = runCatching { Sessao.consultar(context, token) { NotificacoesApi.salvarPreferencias(it, preferencias) } }
                .getOrElse { Resposta.Falha(NOTIFICACAO_MSG_FALHA_GENERICA, 0) }
            PreferenciasLocais.finalizarAlteracao()
            if (resultado is Resposta.Ok && !preferencias.push) NotificadorLocal.limpar(context)
            Handler(Looper.getMainLooper()).post {
                if (desmontada.value || !Sessao.mesmaSessao(token, TokenStore.read(context))) return@post
                salvando = false
                when (resultado) {
                    is Resposta.Ok -> {
                        push = preferencias.push
                        email = preferencias.email
                    }
                    // Sem sucesso falso: o switch volta ao estado anterior e o erro aparece.
                    is Resposta.Falha -> {
                        push = anterior.push
                        email = anterior.email
                        erro = resultado.mensagem
                    }
                }
            }
        }.start()
    }

    Column(modifier) {
        if (carregando) {
            Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.padding(12.dp)) {
                CircularProgressIndicator(color = DeepTeal, modifier = Modifier.size(16.dp), strokeWidth = 2.dp)
                Spacer(Modifier.width(10.dp))
                Text("Carregando preferências…", color = Muted, fontSize = 12.sp)
            }
        } else {
            if (erro.isNotBlank()) {
                Text(erro, color = Color(0xFFB3261E), fontSize = 11.sp, modifier = Modifier.padding(horizontal = 12.dp, vertical = 4.dp))
            }
            LinhaPreferencia(
                titulo = "Notificações no aparelho",
                detalhe = "Novidades verificadas periodicamente. Pode haver atraso.",
                valor = push,
                ocupado = salvando,
                onChange = { novoValor ->
                    if (novoValor && Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
                        !permissaoNotificacoesConcedida(context)
                    ) {
                        pedirPermissao.launch(Manifest.permission.POST_NOTIFICATIONS)
                    }
                    salvar(
                        PreferenciasNotificacao(push = novoValor, email = email),
                        anterior = PreferenciasNotificacao(push = push, email = email),
                    )
                },
            )
            HorizontalDivider(color = Color(0xFFE9ECEF))
            LinhaPreferencia(
                titulo = "Notificações por e-mail",
                detalhe = "Receba os mesmos alertas no seu e-mail.",
                valor = email,
                ocupado = salvando,
                onChange = { novoValor ->
                    salvar(
                        PreferenciasNotificacao(push = push, email = novoValor),
                        anterior = PreferenciasNotificacao(push = push, email = email),
                    )
                },
            )
            if (push && !permissaoNotificacoesConcedida(context)) {
                Text(
                    "A permissão de notificações do Android está desativada. A preferência está salva, mas os alertas não aparecerão na bandeja.",
                    color = Muted,
                    fontSize = 10.sp,
                    lineHeight = 14.sp,
                    modifier = Modifier.padding(horizontal = 12.dp, vertical = 4.dp),
                )
                Text(
                    "Abrir configurações do app",
                    color = DeepTeal,
                    fontSize = 11.sp,
                    fontWeight = FontWeight.Bold,
                    modifier = Modifier
                        .clickable {
                            context.startActivity(
                                Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS)
                                    .setData(Uri.fromParts("package", context.packageName, null)),
                            )
                        }
                        .padding(horizontal = 12.dp, vertical = 4.dp),
                )
            }
        }
    }
}

@Composable
private fun LinhaPreferencia(titulo: String, detalhe: String, valor: Boolean, ocupado: Boolean, onChange: (Boolean) -> Unit) {
    Row(modifier = Modifier.fillMaxWidth().padding(11.dp), verticalAlignment = Alignment.CenterVertically) {
        Box(
            modifier = Modifier.size(38.dp).clip(RoundedCornerShape(8.dp)).background(Color(0xFFE1F3FA)),
            contentAlignment = Alignment.Center,
        ) { Icon(Icons.Default.NotificationsNone, null, tint = Color(0xFF176FAD), modifier = Modifier.size(21.dp)) }
        Spacer(Modifier.width(10.dp))
        Column(modifier = Modifier.weight(1f)) {
            Text(titulo, color = Navy, fontSize = 11.sp, fontWeight = FontWeight.Bold)
            Text(detalhe, color = Navy, fontSize = 9.sp, maxLines = 1, overflow = androidx.compose.ui.text.style.TextOverflow.Ellipsis)
        }
        if (ocupado) {
            CircularProgressIndicator(color = DeepTeal, modifier = Modifier.size(16.dp), strokeWidth = 2.dp)
            Spacer(Modifier.width(8.dp))
        }
        Switch(
            checked = valor,
            onCheckedChange = onChange,
            modifier = Modifier.height(28.dp),
            colors = SwitchDefaults.colors(
                checkedThumbColor = Color.White,
                checkedTrackColor = Color(0xFF82F38A),
                uncheckedThumbColor = Color.White,
                uncheckedTrackColor = Color(0xFFE7E7ED),
            ),
        )
    }
}

internal fun permissaoNotificacoesConcedida(context: Context): Boolean =
    Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU ||
        ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) ==
        PackageManager.PERMISSION_GRANTED
