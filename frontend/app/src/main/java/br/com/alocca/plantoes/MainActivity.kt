package br.com.alocca.plantoes

import android.os.Bundle
import android.os.Handler
import android.os.Looper
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.core.view.WindowCompat
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.expandIn
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.shrinkOut
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Email
import androidx.compose.material.icons.filled.Lock
import androidx.compose.material.icons.filled.KeyboardArrowDown
import androidx.compose.material.icons.filled.PersonOutline
import androidx.compose.material.icons.filled.Visibility
import androidx.compose.material.icons.filled.VisibilityOff
import androidx.compose.material.icons.filled.AccessTime
import androidx.compose.material.icons.filled.AccountBalanceWallet
import androidx.compose.material.icons.filled.CalendarMonth
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.ChevronRight
import androidx.compose.material.icons.filled.EventNote
import androidx.compose.material.icons.filled.Home
import androidx.compose.material.icons.filled.LocationOn
import androidx.compose.material.icons.filled.Logout
import androidx.compose.material.icons.filled.Menu
import androidx.compose.material.icons.filled.NotificationsNone
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.filled.Security
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material.icons.filled.Star
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.OffsetMapping
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.TransformedText
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import androidx.compose.ui.graphics.drawscope.Fill
import org.json.JSONObject

private val Navy = Color(0xFF063957)
private val DeepTeal = Color(0xFF07566A)
private val Cyan = Color(0xFF09A9CE)
private val Muted = Color(0xFF657775)
private val CanvasColor = Color(0xFFF3F9F8)
private val Border = Color(0xFF48A8BC)

private data class ShiftDetails(
    val day: String,
    val month: String,
    val weekday: String,
    val status: String,
    val hospital: String,
    val specialty: String,
    val location: String,
    val value: String,
    val confirmed: Boolean,
)

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        TokenStore.discardLegacyPlaintext(this)

        // Permite que o fundo chegue até as bordas, atrás da barra de status e navegação.
        WindowCompat.setDecorFitsSystemWindows(window, false)
        window.statusBarColor = android.graphics.Color.TRANSPARENT
        window.navigationBarColor = android.graphics.Color.TRANSPARENT
        WindowCompat.getInsetsController(window, window.decorView).apply {
            isAppearanceLightStatusBars = false
            isAppearanceLightNavigationBars = false
        }

        setContent { MaterialTheme { AuthApp() } }
    }
}

private enum class Screen { Login, Register }

@Composable
private fun AuthApp() {
    var screen by remember { mutableStateOf(Screen.Login) }
    var loading by remember { mutableStateOf(false) }
    var feedback by remember { mutableStateOf("") }
    var feedbackSuccess by remember { mutableStateOf(false) }
    var perfil by remember { mutableStateOf<PerfilUsuario?>(null) }
    var restoring by remember { mutableStateOf(true) }
    var podeTentarRestaurar by remember { mutableStateOf(false) }
    val context = androidx.compose.ui.platform.LocalContext.current

    fun restaurarSessao() {
        Thread {
            val token = TokenStore.read(context)
            if (token == null) {
                Handler(Looper.getMainLooper()).post { restoring = false }
            } else {
                val result = AuthApi.getProfile(token)
                val autenticado = if (result.successful) PerfilUsuario.fromJson(result.body) else null
                val sessionExpired = result.status == 401 || result.status == 403
                // Remove só o token consultado: se um novo login acontecer durante
                // a restauração, o token recém-salvo continua intacto.
                if (autenticado == null && (result.successful || sessionExpired)) {
                    TokenStore.clearIfMatches(context, token)
                }
                Handler(Looper.getMainLooper()).post {
                    when {
                        autenticado != null -> {
                            perfil = autenticado
                            podeTentarRestaurar = false
                            feedback = ""
                        }
                        sessionExpired -> {
                            feedback = "Sua sessão expirou. Entre novamente."
                            podeTentarRestaurar = false
                        }
                        else -> {
                            feedback = result.message.ifBlank {
                                "Não foi possível restaurar sua sessão. Entre novamente."
                            }
                            // Falha de rede preserva o token; oferecer nova tentativa
                            // da restauração sem exigir credenciais.
                            podeTentarRestaurar = true
                        }
                    }
                    restoring = false
                }
            }
        }.start()
    }

    fun tentarRestaurarNovamente() {
        feedback = ""
        podeTentarRestaurar = false
        restoring = true
        restaurarSessao()
    }

    LaunchedEffect(Unit) { restaurarSessao() }

    fun submit(path: String, payload: JSONObject, onSuccess: (JSONObject?) -> Unit) {
        if (loading) return
        loading = true
        feedback = ""
        Thread {
            val result = AuthApi.post(path, payload)
            Handler(Looper.getMainLooper()).post {
                loading = false
                feedback = if (result.successful) "" else result.message
                feedbackSuccess = false
                if (result.successful) onSuccess(result.body)
            }
        }.start()
    }

    fun logout() {
        if (!TokenStore.clear(context)) {
            // Exclusão em disco falhou: avisar em vez de dizer que a sessão encerrou.
            feedback = "Não foi possível encerrar a sessão. Tente novamente."
            feedbackSuccess = false
            return
        }
        perfil = null
        screen = Screen.Login
        feedback = "Sessão encerrada."
        feedbackSuccess = true
    }

    if (restoring) {
        Surface(Modifier.fillMaxSize(), color = CanvasColor) {
            Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                Column(horizontalAlignment = Alignment.CenterHorizontally) {
                    CircularProgressIndicator(color = DeepTeal)
                    Spacer(Modifier.height(16.dp))
                    Text("Restaurando sua sessão…", color = Muted, fontSize = 13.sp)
                }
            }
        }
        return
    }

    Surface(Modifier.fillMaxSize(), color = CanvasColor) {
        Box(Modifier.fillMaxSize()) {
            DecorativeCorners()

            val currentPerfil = perfil
            if (currentPerfil != null) {
                HomeScreen(currentPerfil, onLogout = ::logout)
            } else {
                Column(
                    modifier = Modifier
                        .fillMaxSize()
                        .statusBarsPadding()
                        .navigationBarsPadding()
                        .verticalScroll(rememberScrollState())
                        .padding(horizontal = 20.dp),
                    horizontalAlignment = Alignment.CenterHorizontally
                ) {
                    // Espaço superior ajustado para aproximar a posição da logo do protótipo.
                    Spacer(Modifier.height(if (screen == Screen.Login) 66.dp else 24.dp))

                    BrandLogo()

                    if (screen == Screen.Login) {
                        Spacer(Modifier.height(23.dp))
                        Text(
                            text = "Conectando profissionais de saúde às\nmelhores oportunidades de plantão.",
                            color = Muted,
                            fontSize = 13.sp,
                            lineHeight = 17.sp,
                            textAlign = TextAlign.Center
                        )
                        Spacer(Modifier.height(40.dp))
                        if (podeTentarRestaurar) {
                            Text(
                                "Tentar novamente",
                                Modifier
                                    .clickable {
                                        tentarRestaurarNovamente()
                                    }
                                    .padding(8.dp),
                                color = Border,
                                fontWeight = FontWeight.Bold,
                                fontSize = 13.sp
                            )
                            Spacer(Modifier.height(16.dp))
                        }
                        LoginForm(
                            onRegister = { feedback = ""; screen = Screen.Register },
                            loading = loading,
                            feedback = feedback,
                            feedbackSuccess = feedbackSuccess,
                            onSubmit = { email, senha ->
                                val payload = JSONObject().put("email", email.trim()).put("senha", senha)
                                submit("auth/login", payload) { response ->
                                    val token = response?.optString("access_token")?.trim().orEmpty()
                                    val autenticado = PerfilUsuario.fromLoginResponse(response)
                                    if (token.isBlank() || autenticado == null) {
                                        feedback = "O servidor retornou uma sessão inválida. Tente novamente."
                                        feedbackSuccess = false
                                    } else {
                                        try {
                                            TokenStore.save(context, token)
                                            perfil = autenticado
                                            feedback = ""
                                            feedbackSuccess = false
                                        } catch (_: Exception) {
                                            feedback = "Não foi possível salvar a sessão com segurança. Tente novamente."
                                            feedbackSuccess = false
                                        }
                                    }
                                }
                            }
                        )
                    } else {
                        Spacer(Modifier.height(10.dp))
                        Text("Criar sua conta", color = Navy, fontSize = 23.sp, fontWeight = FontWeight.Medium)
                        Spacer(Modifier.height(4.dp))
                        Text("Preencha os dados abaixo para começar.", color = Muted, fontSize = 13.sp)
                        Spacer(Modifier.height(18.dp))
                        RegisterForm(
                            onLogin = { feedback = ""; screen = Screen.Login },
                            loading = loading,
                            feedback = feedback,
                            feedbackSuccess = feedbackSuccess,
                            onSubmit = { nome, email, cpf, crm, uf, senha ->
                                val payload = JSONObject().put("nome", nome.trim()).put("email", email.trim())
                                    .put("cpf", cpf).put("senha", senha)
                                    .put("crm", crm.trim()).put("uf_crm", uf.trim().uppercase())
                                submit("auth/register/medico", payload) {
                                    feedback = "Cadastro enviado. A validação do seu CRM é manual; você já pode entrar."
                                    feedbackSuccess = true
                                    screen = Screen.Login
                                }
                            }
                        )
                    }

                    Spacer(Modifier.height(18.dp))
                    PrivacyCard()
                    Spacer(Modifier.height(28.dp))
                }
            }
        }
    }
}

@Composable
private fun HomeScreen(perfil: PerfilUsuario, onLogout: () -> Unit) {
    var activeTab by remember { mutableStateOf("Início") }
    var notice by remember { mutableStateOf("") }
    var selectedShift by remember { mutableStateOf<ShiftDetails?>(null) }
    var notificationsOpen by remember { mutableStateOf(false) }
    val primeiroNome = perfil.nome.trim().substringBefore(" ").ifBlank { "Doutor(a)" }

    if (activeTab == "Financeiro") {
        FinanceScreen(onTabSelected = { activeTab = it })
        return
    }

    Surface(modifier = Modifier.fillMaxSize(), color = Color.White) {
        Box(modifier = Modifier.fillMaxSize()) {
            Column(
                modifier = Modifier
                    .fillMaxSize()
                    .statusBarsPadding()
                    .navigationBarsPadding(),
            ) {
                HomeHeader(
                    onNotification = { notificationsOpen = !notificationsOpen },
                    onLogout = onLogout,
                )
            Column(
                modifier = Modifier
                    .weight(1f)
                    .verticalScroll(rememberScrollState())
                    .padding(horizontal = 20.dp),
            ) {
                Spacer(Modifier.height(19.dp))
                Text("Olá, Dr. $primeiroNome", color = Navy, fontSize = 20.sp, fontWeight = FontWeight.Bold)
                Spacer(Modifier.height(3.dp))
                Text(
                    "Encontre plantões, acompanhe suas\natividades e gerencie seus plantões.",
                    color = Navy,
                    fontSize = 13.sp,
                    lineHeight = 16.sp,
                )
                Spacer(Modifier.height(16.dp))
                QuickSummary()
                Spacer(Modifier.height(18.dp))
                SectionTitle("Próximos plantões", "Ver todos") { notice = "Em breve você poderá ver todos os plantões." }
                Spacer(Modifier.height(9.dp))
                ShiftCard("20", "JUN", "Sex. 19h", "CONFIRMADO", "Hospital Santa Clara", "Clínica Médica", "Gama - DF", "R$ 800,00", true) { shift -> selectedShift = shift }
                Spacer(Modifier.height(8.dp))
                ShiftCard("20", "JUN", "Sex. 19h", "PENDENTE", "Hospital Santa Lúcia", "Clínica Médica", "Taguatinga - DF", "R$ 950,00", false) { shift -> selectedShift = shift }
                Spacer(Modifier.height(8.dp))
                ShiftCard("24", "JUN", "Ter. 19h", "CONFIRMADO", "Hospital Brasília", "Pediatria", "Brasília - DF", "R$ 700,00", true) { shift -> selectedShift = shift }
                Spacer(Modifier.height(18.dp))
                Text("Ações rápidas", color = Navy, fontSize = 14.sp, fontWeight = FontWeight.Bold)
                Spacer(Modifier.height(10.dp))
                QuickActions { notice = "$it estará disponível em breve." }
                if (notice.isNotBlank()) {
                    Spacer(Modifier.height(16.dp))
                    Text(
                        notice,
                        color = DeepTeal,
                        fontSize = 12.sp,
                        modifier = Modifier
                            .fillMaxWidth()
                            .clip(RoundedCornerShape(8.dp))
                            .background(Color(0xFFE1F3F4))
                            .padding(11.dp),
                    )
                }
                Spacer(Modifier.height(22.dp))
            }
                HomeBottomNavigation(activeTab, onSelected = { selected ->
                    activeTab = selected
                    notice = "$selected estará disponível em breve."
                })
            }

            AnimatedVisibility(
                visible = notificationsOpen,
                modifier = Modifier.align(Alignment.TopEnd).statusBarsPadding().padding(top = 68.dp, end = 16.dp),
                enter = expandIn(expandFrom = Alignment.TopEnd) + fadeIn(),
                exit = shrinkOut(shrinkTowards = Alignment.TopEnd) + fadeOut(),
            ) {
                NotificationsPanel(onClose = { notificationsOpen = false })
            }

            selectedShift?.let { shift ->
                ShiftDetailsDialog(shift = shift, onDismiss = { selectedShift = null })
            }
        }
    }
}

@Composable
private fun FinanceScreen(onTabSelected: (String) -> Unit) {
    var selectedShift by remember { mutableStateOf<ShiftDetails?>(null) }
    var notificationsOpen by remember { mutableStateOf(false) }

    Surface(modifier = Modifier.fillMaxSize(), color = Color.White) {
        Box(modifier = Modifier.fillMaxSize()) {
            Column(modifier = Modifier.fillMaxSize().statusBarsPadding().navigationBarsPadding()) {
                Row(
                    modifier = Modifier.fillMaxWidth().height(58.dp).border(width = 1.dp, color = Color(0xFFE0E5E5)).padding(horizontal = 20.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text("Financeiro", color = Navy, fontSize = 18.sp, fontWeight = FontWeight.Bold)
                    Spacer(Modifier.weight(1f))
                    Box(
                        modifier = Modifier.size(40.dp).clickable { notificationsOpen = !notificationsOpen },
                        contentAlignment = Alignment.Center,
                    ) {
                        Icon(Icons.Default.NotificationsNone, "Notificações", tint = Navy, modifier = Modifier.size(24.dp))
                        Box(
                            modifier = Modifier.align(Alignment.TopEnd).offset(x = 0.dp, y = 2.dp).size(17.dp)
                                .clip(androidx.compose.foundation.shape.CircleShape).background(Cyan),
                            contentAlignment = Alignment.Center,
                        ) {
                            Text("3", color = Color.White, fontSize = 9.sp, lineHeight = 10.sp, fontWeight = FontWeight.Bold, textAlign = TextAlign.Center)
                        }
                    }
                }
                Column(
                    modifier = Modifier.weight(1f).verticalScroll(rememberScrollState()).padding(horizontal = 27.dp),
                ) {
                    Spacer(Modifier.height(10.dp))
                    FinancialSummary()
                    Spacer(Modifier.height(17.dp))
                    Text("A receber", color = Color(0xFF20252B), fontSize = 16.sp, fontWeight = FontWeight.Bold)
                    Spacer(Modifier.height(11.dp))
                    ShiftCard("20", "JUN", "Sex. 19h", "CONFIRMADO", "Hospital Santa Clara", "Clínica Médica", "Gama - DF", "R$ 800,00", true) { selectedShift = it }
                    Spacer(Modifier.height(10.dp))
                    ShiftCard("20", "JUN", "Sex. 19h", "PENDENTE", "Hospital Santa Lúcia", "Clínica Médica", "Taguatinga - DF", "R$ 950,00", false) { selectedShift = it }
                    Spacer(Modifier.height(10.dp))
                    ShiftCard("24", "JUN", "Ter. 19h", "CONFIRMADO", "Hospital Brasília", "Pediatria", "Brasília - DF", "R$ 700,00", true) { selectedShift = it }
                    Spacer(Modifier.height(10.dp))
                    ShiftCard("24", "JUN", "Ter. 19h", "CONFIRMADO", "Hospital Brasília", "Pediatria", "Brasília - DF", "R$ 700,00", true) { selectedShift = it }
                    Spacer(Modifier.height(24.dp))
                }
                HomeBottomNavigation("Financeiro", onSelected = onTabSelected)
            }
            selectedShift?.let { shift ->
                ShiftDetailsDialog(shift = shift, onDismiss = { selectedShift = null })
            }
            AnimatedVisibility(
                visible = notificationsOpen,
                modifier = Modifier.align(Alignment.TopEnd).statusBarsPadding().padding(top = 52.dp, end = 16.dp),
                enter = expandIn(expandFrom = Alignment.TopEnd) + fadeIn(),
                exit = shrinkOut(shrinkTowards = Alignment.TopEnd) + fadeOut(),
            ) { NotificationsPanel(onClose = { notificationsOpen = false }) }
        }
    }
}

@Composable
private fun FinancialSummary() {
    Row(
        modifier = Modifier.fillMaxWidth().clip(RoundedCornerShape(14.dp)).background(Color(0xFF164D86)).padding(horizontal = 9.dp, vertical = 12.dp),
        horizontalArrangement = Arrangement.SpaceBetween,
    ) {
        FinancialMetric(Icons.Default.AccountBalanceWallet, Color(0xFF0EA06D), "A receber", "R$2.450,00", "3 plantões")
        FinancialMetric(Icons.Default.CheckCircle, Color(0xFF087FE0), "Recebidos", "R$6.759,00", "Este mês")
        FinancialMetric(Icons.Default.CalendarMonth, Color(0xFF775DAD), "Pendentes", "R$1.500,00", "2 plantões")
        FinancialMetric(Icons.Default.Star, Color(0xFFF69A17), "Total do mês", "R$8.200,00", "▲12% vs mês anterior")
    }
}

@Composable
private fun FinancialMetric(icon: androidx.compose.ui.graphics.vector.ImageVector, accent: Color, label: String, value: String, detail: String) {
    Column(modifier = Modifier.width(72.dp), horizontalAlignment = Alignment.CenterHorizontally) {
        Box(modifier = Modifier.size(30.dp).clip(RoundedCornerShape(8.dp)).background(accent), contentAlignment = Alignment.Center) {
            Icon(icon, null, tint = Color.White, modifier = Modifier.size(19.dp))
        }
        Spacer(Modifier.height(5.dp))
        Text(label, color = Color.White, fontSize = 9.sp, textAlign = TextAlign.Center, maxLines = 1)
        Spacer(Modifier.height(3.dp))
        Text(value, color = Color.White, fontSize = 11.sp, fontWeight = FontWeight.Bold, textAlign = TextAlign.Center, maxLines = 1)
        Text(detail, color = if (detail.startsWith("▲")) Color(0xFF61D495) else Color.White, fontSize = 8.sp, textAlign = TextAlign.Center, lineHeight = 10.sp, maxLines = 2)
    }
}

/** Tela isolada para inspeção no Android Studio, sem login ou backend. */
@Preview(showBackground = true, backgroundColor = 0xFFFFFFFF, widthDp = 393, heightDp = 852)
@Composable
private fun HomeScreenPreview() {
    MaterialTheme {
        HomeScreen(
            PerfilUsuario(
                id = "preview-medico",
                nome = "Bean",
                email = "bean@alocca.com",
                tipo = "MEDICO",
                status = "ATIVO",
                crm = "123456",
                ufCrm = "DF",
                statusValidacao = "APROVADO",
                motivoRejeicao = null,
            ),
            onLogout = {},
        )
    }
}

@Composable
private fun HomeHeader(onNotification: () -> Unit, onLogout: () -> Unit) {
    var menuOpen by remember { mutableStateOf(false) }
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .height(76.dp)
            .border(width = 1.dp, color = Color(0xFFE0E5E5))
            .padding(horizontal = 19.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(
            modifier = Modifier.size(40.dp).clickable { menuOpen = !menuOpen },
            contentAlignment = Alignment.Center,
        ) {
            Icon(Icons.Default.Menu, contentDescription = "Menu", tint = Navy, modifier = Modifier.size(25.dp))
            DropdownMenu(expanded = menuOpen, onDismissRequest = { menuOpen = false }) {
                DropdownMenuItem(
                    text = { Text("Sair da conta") },
                    leadingIcon = { Icon(Icons.Default.Logout, contentDescription = null) },
                    onClick = {
                        menuOpen = false
                        onLogout()
                    },
                )
            }
        }
        Spacer(Modifier.width(17.dp))
        Image(
            painter = painterResource(id = R.drawable.alocca_logo),
            contentDescription = "Alocca Plantões",
            modifier = Modifier.width(110.dp).height(46.dp),
        )
        Spacer(Modifier.weight(1f))
        Box(
            modifier = Modifier
                .size(44.dp)
                .clickable(onClick = onNotification),
            contentAlignment = Alignment.Center,
        ) {
            Icon(
                Icons.Default.NotificationsNone,
                contentDescription = "Notificações",
                tint = Navy,
                modifier = Modifier.size(27.dp),
            )
            Box(
                modifier = Modifier
                    .align(Alignment.TopEnd)
                    .offset(x = (-1).dp, y = 2.dp)
                    .size(16.dp)
                    .clip(androidx.compose.foundation.shape.CircleShape)
                    .background(Cyan),
                contentAlignment = Alignment.Center,
            ) {
                Text(
                    text = "3",
                    color = Color.White,
                    fontSize = 9.sp,
                    lineHeight = 10.sp,
                    fontWeight = FontWeight.Bold,
                    textAlign = TextAlign.Center,
                )
            }
        }
    }
}

@Composable
private fun NotificationsPanel(onClose: () -> Unit) {
    Surface(
        modifier = Modifier.width(300.dp),
        shape = RoundedCornerShape(16.dp),
        color = Color.White,
        shadowElevation = 10.dp,
        border = androidx.compose.foundation.BorderStroke(1.dp, Color(0xFFE0E5E5)),
    ) {
        Column(modifier = Modifier.padding(18.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text("Notificações", color = Navy, fontSize = 17.sp, fontWeight = FontWeight.Bold)
                Spacer(Modifier.weight(1f))
                Text("3 novas", color = Cyan, fontSize = 12.sp, fontWeight = FontWeight.Bold)
            }
            Spacer(Modifier.height(15.dp))
            NotificationItem(Icons.Default.EventNote, "Plantão confirmado", "Hospital Santa Clara • Sex. 19h")
            Spacer(Modifier.height(13.dp))
            NotificationItem(Icons.Default.AccessTime, "Confirmação pendente", "Responda ao plantão do Hospital Santa Lúcia")
            Spacer(Modifier.height(13.dp))
            NotificationItem(Icons.Default.AccountBalanceWallet, "Pagamento recebido", "R$ 2.459,00 disponível em seu saldo")
            Spacer(Modifier.height(16.dp))
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
private fun NotificationItem(icon: androidx.compose.ui.graphics.vector.ImageVector, title: String, description: String) {
    Row(verticalAlignment = Alignment.Top) {
        Box(
            modifier = Modifier.size(34.dp).clip(RoundedCornerShape(9.dp)).background(Color(0xFFE1F3F4)),
            contentAlignment = Alignment.Center,
        ) {
            Icon(icon, contentDescription = null, tint = DeepTeal, modifier = Modifier.size(19.dp))
        }
        Spacer(Modifier.width(10.dp))
        Column(modifier = Modifier.weight(1f)) {
            Text(title, color = Navy, fontSize = 13.sp, fontWeight = FontWeight.Bold)
            Spacer(Modifier.height(2.dp))
            Text(description, color = Muted, fontSize = 11.sp, lineHeight = 14.sp)
        }
    }
}

@Composable
private fun QuickSummary() {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(9.dp))
            .background(Color(0xFF004180))
            .padding(vertical = 12.dp),
        horizontalArrangement = Arrangement.SpaceEvenly,
    ) {
        SummaryItem(Icons.Default.CalendarMonth, Color(0xFF316B9E), "3", "Plantões\nconfirmados")
        SummaryItem(Icons.Default.AccessTime, Color(0xFF009A7B), "1", "Pendências de\nconfirmação")
        SummaryItem(Icons.Default.AccountBalanceWallet, Color(0xFF7564A9), "R$2.459,00", "Recebidos")
        SummaryItem(Icons.Default.Star, Color(0xFFF5A600), "4,8", "Avaliação\nmédia")
    }
}

@Composable
private fun SummaryItem(icon: androidx.compose.ui.graphics.vector.ImageVector, color: Color, value: String, label: String) {
    Column(
        modifier = Modifier.width(78.dp).height(79.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        // Todos os indicadores usam o mesmo espaço reservado: isso evita que o
        // desenho interno de cada ícone altere o alinhamento visual da linha.
        Box(
            modifier = Modifier.size(30.dp).clip(RoundedCornerShape(8.dp)).background(color),
            contentAlignment = Alignment.Center,
        ) {
            Icon(icon, contentDescription = null, tint = Color.White, modifier = Modifier.size(18.dp))
        }
        Spacer(Modifier.height(6.dp))
        Text(
            value,
            color = Color.White,
            fontSize = 11.sp,
            fontWeight = FontWeight.Bold,
            maxLines = 1,
            modifier = Modifier.height(17.dp),
        )
        Spacer(Modifier.height(3.dp))
        Text(
            label,
            color = Color.White,
            fontSize = 8.sp,
            lineHeight = 10.sp,
            textAlign = TextAlign.Center,
            modifier = Modifier.height(22.dp),
        )
    }
}

@Composable
private fun SectionTitle(title: String, action: String, onAction: () -> Unit) {
    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
        Text(title, color = Navy, fontSize = 14.sp, fontWeight = FontWeight.Bold)
        Spacer(Modifier.weight(1f))
        Text(action, color = Cyan, fontSize = 13.sp, fontWeight = FontWeight.Bold, modifier = Modifier.clickable(onClick = onAction))
    }
}

@Composable
private fun ShiftCard(
    day: String, month: String, weekday: String, status: String, hospital: String, specialty: String,
    location: String, value: String, confirmed: Boolean, onClick: (ShiftDetails) -> Unit,
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .height(103.dp)
            .clip(RoundedCornerShape(13.dp))
            .background(Color.White)
            .border(1.dp, Color(0xFF9DA5A6), RoundedCornerShape(13.dp))
            .clickable {
                onClick(ShiftDetails(day, month, weekday, status, hospital, specialty, location, value, confirmed))
            }
            .padding(10.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(
            modifier = Modifier
                .width(66.dp)
                .fillMaxHeight()
                .clip(RoundedCornerShape(12.dp))
                .background(if (confirmed) Color(0xFFD9F3FC) else Color(0xFFFFF1DF)),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.Center,
        ) {
            Text(day, color = Navy, fontSize = 18.sp, fontWeight = FontWeight.Bold)
            Text(month, color = Navy, fontSize = 11.sp, fontWeight = FontWeight.Bold)
            Spacer(Modifier.height(7.dp))
            Text(weekday, color = Navy, fontSize = 11.sp, fontWeight = FontWeight.Bold)
        }
        Spacer(Modifier.width(10.dp))
        Column(modifier = Modifier.weight(1f)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(
                    status,
                    color = if (confirmed) Color(0xFF1381C8) else Color(0xFFF49A19),
                    fontSize = 8.sp,
                    fontWeight = FontWeight.Bold,
                    modifier = Modifier.background(if (confirmed) Color(0xFFD7EFFF) else Color(0xFFFFECD3)).padding(horizontal = 6.dp, vertical = 2.dp),
                )
                Spacer(Modifier.weight(1f))
                Text(value, color = if (confirmed) Color(0xFF008872) else Color(0xFFF49A19), fontSize = 9.sp, fontWeight = FontWeight.Bold,
                    modifier = Modifier.background(if (confirmed) Color(0xFFD7EFEA) else Color(0xFFFFF1DF)).padding(horizontal = 6.dp, vertical = 2.dp))
            }
            Spacer(Modifier.height(4.dp))
            Text(hospital, color = Navy, fontSize = 13.sp, fontWeight = FontWeight.Bold, maxLines = 1, overflow = TextOverflow.Ellipsis)
            Text(specialty, color = Navy, fontSize = 11.sp, fontWeight = FontWeight.SemiBold)
            Spacer(Modifier.height(4.dp))
            Row(verticalAlignment = Alignment.CenterVertically) {
                Icon(Icons.Default.LocationOn, null, tint = Muted, modifier = Modifier.size(11.dp))
                Text(location, color = Muted, fontSize = 9.sp)
            }
            Row(verticalAlignment = Alignment.CenterVertically) {
                Icon(Icons.Default.AccessTime, null, tint = Muted, modifier = Modifier.size(11.dp))
                Text("19:00 - 7:00 (12h)", color = Muted, fontSize = 9.sp)
            }
        }
        Icon(Icons.Default.ChevronRight, contentDescription = "Abrir plantão", tint = Muted, modifier = Modifier.size(20.dp))
    }
}

@Composable
private fun ShiftDetailsDialog(shift: ShiftDetails, onDismiss: () -> Unit) {
    val accent = if (shift.confirmed) Color(0xFF008872) else Color(0xFFF49A19)
    val statusBackground = if (shift.confirmed) Color(0xFFD7EFEA) else Color(0xFFFFECD3)

    Dialog(
        onDismissRequest = onDismiss,
        properties = DialogProperties(usePlatformDefaultWidth = false),
    ) {
        Surface(
            modifier = Modifier.fillMaxWidth().padding(20.dp),
            shape = RoundedCornerShape(20.dp),
            color = Color.White,
            shadowElevation = 12.dp,
        ) {
            Column(modifier = Modifier.padding(24.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Column(modifier = Modifier.weight(1f)) {
                        Text("Detalhes do plantão", color = Navy, fontSize = 20.sp, fontWeight = FontWeight.Bold)
                        Spacer(Modifier.height(4.dp))
                        Text("${shift.day} ${shift.month} • ${shift.weekday}", color = Muted, fontSize = 13.sp)
                    }
                    Text(
                        shift.status,
                        color = accent,
                        fontSize = 10.sp,
                        fontWeight = FontWeight.Bold,
                        modifier = Modifier.clip(RoundedCornerShape(6.dp)).background(statusBackground).padding(horizontal = 9.dp, vertical = 6.dp),
                    )
                }
                Spacer(Modifier.height(22.dp))
                Text(shift.hospital, color = Navy, fontSize = 18.sp, fontWeight = FontWeight.Bold)
                Spacer(Modifier.height(4.dp))
                Text(shift.specialty, color = Muted, fontSize = 14.sp)
                Spacer(Modifier.height(20.dp))
                DetailLine(Icons.Default.LocationOn, "Local", shift.location)
                Spacer(Modifier.height(14.dp))
                DetailLine(Icons.Default.AccessTime, "Horário", "19:00 às 07:00 • duração de 12h")
                Spacer(Modifier.height(14.dp))
                DetailLine(Icons.Default.AccountBalanceWallet, "Valor do plantão", shift.value, accent)
                Spacer(Modifier.height(24.dp))
                Button(
                    onClick = onDismiss,
                    modifier = Modifier.fillMaxWidth().height(48.dp),
                    colors = ButtonDefaults.buttonColors(containerColor = Navy),
                    shape = RoundedCornerShape(10.dp),
                ) {
                    Text("Fechar", fontWeight = FontWeight.Bold)
                }
            }
        }
    }
}

@Composable
private fun DetailLine(icon: androidx.compose.ui.graphics.vector.ImageVector, label: String, value: String, valueColor: Color = Navy) {
    Row(verticalAlignment = Alignment.CenterVertically) {
        Icon(icon, contentDescription = null, tint = Cyan, modifier = Modifier.size(22.dp))
        Spacer(Modifier.width(12.dp))
        Column {
            Text(label, color = Muted, fontSize = 11.sp)
            Text(value, color = valueColor, fontSize = 14.sp, fontWeight = FontWeight.SemiBold)
        }
    }
}

@Composable
private fun QuickActions(onAction: (String) -> Unit) {
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
        ActionItem(Icons.Default.Security, "Segurança", Color(0xFFDDF4FC), Color(0xFF1683BF)) { onAction("Segurança") }
        ActionItem(Icons.Default.CalendarMonth, "Calendário", Color(0xFFE0F7EE), Color(0xFF008A70)) { onAction("Calendário") }
        ActionItem(Icons.Default.LocationOn, "Locais de\ntrabalho", Color(0xFFF1EAFE), Color(0xFF7351A5)) { onAction("Locais de trabalho") }
        ActionItem(Icons.Default.PersonOutline, "Seu perfil", Color(0xFFFFF0D9), Color(0xFFF29A14)) { onAction("Seu perfil") }
    }
}

@Composable
private fun ActionItem(icon: androidx.compose.ui.graphics.vector.ImageVector, label: String, background: Color, tint: Color, onClick: () -> Unit) {
    Column(
        modifier = Modifier
            .width(70.dp)
            .height(68.dp)
            .clip(RoundedCornerShape(10.dp))
            .background(background)
            .clickable(onClick = onClick)
            .padding(vertical = 7.dp, horizontal = 3.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.SpaceBetween,
    ) {
        Icon(icon, null, tint = tint, modifier = Modifier.size(24.dp))
        Text(
            label,
            color = tint,
            fontSize = 9.sp,
            lineHeight = 11.sp,
            textAlign = TextAlign.Center,
            fontWeight = FontWeight.SemiBold,
            modifier = Modifier.height(22.dp),
        )
    }
}

@Composable
private fun HomeBottomNavigation(active: String, onSelected: (String) -> Unit) {
    val items = listOf(
        Triple("Início", Icons.Default.Home, "Início"),
        Triple("Buscar", Icons.Default.Search, "Buscar"),
        Triple("Plantões", Icons.Default.EventNote, "Plantões"),
        Triple("Financeiro", Icons.Default.AccountBalanceWallet, "Financeiro"),
        Triple("Configurações", Icons.Default.Settings, "Configurações"),
    )
    Row(
        modifier = Modifier.fillMaxWidth().height(65.dp).border(1.dp, Color(0xFFE2E5E6)).background(Color.White),
        horizontalArrangement = Arrangement.SpaceEvenly,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        items.forEach { (name, icon, label) ->
            val selected = active == name
            val isShiftsTab = name == "Plantões"
            Column(
                modifier = Modifier.width(65.dp).clickable { onSelected(name) },
                horizontalAlignment = Alignment.CenterHorizontally,
            ) {
                Box(
                    modifier = Modifier
                        .size(if (selected && !isShiftsTab) 37.dp else if (isShiftsTab) 38.dp else 29.dp)
                        .clip(androidx.compose.foundation.shape.CircleShape)
                        .background(if (selected && !isShiftsTab) Color(0xFF1475D1) else Color.Transparent),
                    contentAlignment = Alignment.Center,
                ) {
                    if (isShiftsTab) {
                        Image(
                            painter = painterResource(id = R.drawable.alocca_hotbar_mark),
                            contentDescription = "Plantões",
                            modifier = Modifier.size(38.dp),
                        )
                    } else {
                        Icon(
                            icon,
                            contentDescription = label,
                            tint = if (selected) Color.White else Color(0xFF152226),
                            modifier = Modifier.size(21.dp),
                        )
                    }
                }
                Text(
                    label,
                    color = if (selected || isShiftsTab) Color(0xFF1475D1) else Color(0xFF152226),
                    fontSize = 9.sp,
                    fontWeight = if (selected || isShiftsTab) FontWeight.Bold else FontWeight.Normal,
                )
            }
        }
    }
}

@Composable
private fun InfoRow(label: String, value: String) {
    Row(
        modifier = Modifier.fillMaxWidth().padding(vertical = 5.dp),
        verticalAlignment = Alignment.Top,
    ) {
        Text(
            text = label,
            color = Muted,
            fontSize = 12.sp,
            modifier = Modifier.weight(0.4f),
        )
        Text(
            text = value,
            color = Navy,
            fontSize = 12.sp,
            fontWeight = FontWeight.SemiBold,
            textAlign = TextAlign.End,
            modifier = Modifier.weight(0.6f),
        )
    }
}

@Composable
private fun DecorativeCorners() {
    androidx.compose.foundation.Canvas(Modifier.fillMaxSize()) {
        // Faixa diagonal no canto superior esquerdo.
        val top = Path().apply {
            moveTo(0f, 0f)
            lineTo(size.width * 0.29f, 0f)
            lineTo(0f, size.height * 0.155f)
            close()
        }
        drawPath(top, Color(0xFF4AA7B5), style = Fill)
        val topDark = Path().apply {
            moveTo(0f, 0f)
            lineTo(size.width * 0.17f, 0f)
            lineTo(0f, size.height * 0.095f)
            close()
        }
        drawPath(topDark, Navy, style = Fill)

        // Faixas diagonais do canto inferior direito.
        val bottomLight = Path().apply {
            moveTo(size.width, size.height * 0.91f)
            lineTo(size.width, size.height)
            lineTo(size.width * 0.68f, size.height)
            close()
        }
        drawPath(bottomLight, Color(0xFFB1DCE0), style = Fill)
        val bottomDark = Path().apply {
            moveTo(size.width, size.height * 0.945f)
            lineTo(size.width, size.height)
            lineTo(size.width * 0.80f, size.height)
            close()
        }
        drawPath(bottomDark, Navy, style = Fill)
        drawRect(
            color = Navy,
            topLeft = androidx.compose.ui.geometry.Offset(0f, size.height - 14.dp.toPx()),
            size = androidx.compose.ui.geometry.Size(22.dp.toPx(), 14.dp.toPx())
        )
        drawRect(
            color = Color(0xFF72BCC5),
            topLeft = androidx.compose.ui.geometry.Offset(31.dp.toPx(), size.height - 14.dp.toPx()),
            size = androidx.compose.ui.geometry.Size(13.dp.toPx(), 14.dp.toPx())
        )
    }
}

@Composable
private fun BrandLogo() {
    Image(
        painter = painterResource(id = R.drawable.alocca_logo),
        contentDescription = "Alocca Plantões",
        modifier = Modifier
            .fillMaxWidth(0.94f)
            .widthIn(max = 330.dp)
            .aspectRatio(2f)
    )
}

@Composable
private fun LoginForm(
    onRegister: () -> Unit,
    loading: Boolean,
    feedback: String,
    feedbackSuccess: Boolean,
    onSubmit: (String, String) -> Unit
) {
    var email by remember { mutableStateOf("") }
    var password by remember { mutableStateOf("") }
    var visible by remember { mutableStateOf(false) }
    var formError by remember { mutableStateOf("") }

    AuthField("E-mail", email, { email = it }, "Seu@email.com", Icons.Default.Email, KeyboardType.Email)
    Spacer(Modifier.height(28.dp))
    AuthField(
        "Senha", password, { password = it }, "Senha", Icons.Default.Lock,
        KeyboardType.Password, password = true, visible = visible,
        onToggle = { visible = !visible }
    )
    Text(
        "Esqueceu sua senha?",
        Modifier.fillMaxWidth().wrapContentWidth(Alignment.End).padding(top = 8.dp).clickable { },
        color = Border, fontWeight = FontWeight.SemiBold, fontSize = 11.sp
    )
    Spacer(Modifier.height(20.dp))
    if (formError.isNotBlank()) FeedbackText(formError, false)
    else if (feedback.isNotBlank()) FeedbackText(feedback, feedbackSuccess)
    PrimaryButton("Entrar", loading) {
        formError = when {
            !email.trim().matches(Regex("^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$")) -> "Informe um e-mail válido."
            password.isEmpty() -> "Informe sua senha."
            password.length > 128 -> "A senha deve ter no máximo 128 caracteres."
            else -> ""
        }
        if (formError.isEmpty()) onSubmit(email, password)
    }
    Row(
        Modifier.fillMaxWidth().padding(vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        HorizontalDivider(Modifier.weight(1f), color = Color(0xFFD7E2E1))
        Text("  ou  ", color = Color(0xFFA6B2B1), fontSize = 12.sp)
        HorizontalDivider(Modifier.weight(1f), color = Color(0xFFD7E2E1))
    }
    Row(verticalAlignment = Alignment.CenterVertically) {
        Text("Não tem uma conta? ", color = Muted, fontSize = 13.sp)
        Text(
            "Cadastre-se",
            Modifier.clickable(onClick = onRegister),
            color = Border, fontWeight = FontWeight.Bold, fontSize = 13.sp
        )
    }
}

// Máscara visual do CRM no cadastro: exibe "123456-SP" anexando a UF ao número.
// O valor do campo guarda só os dígitos (a API continua recebendo crm e uf_crm
// separados); o sufixo é puramente visual, via VisualTransformation.
private const val CRM_DIGITOS_MAX = 20
private const val CPF_DIGITOS = 11

// RN02 — CPF validado pelos dígitos verificadores; RN04 — o campo guarda só
// dígitos, então a higienização já está garantida.
private fun cpfValido(cpf: String): Boolean {
    if (cpf.length != CPF_DIGITOS || cpf.all { it == cpf.first() }) return false
    return listOf(9, 10).all { posicao ->
        val soma = cpf.take(posicao).mapIndexed { indice, caractere ->
            caractere.digitToInt() * (posicao + 1 - indice)
        }.sum()
        val digito = ((soma * 10) % 11).let { if (it == 10) 0 else it }
        cpf[posicao].digitToInt() == digito
    }
}

// RN05 — de 8 a 128 caracteres com maiúscula, minúscula e número.
private fun senhaAtendeRn05(senha: String): Boolean =
    senha.length in 8..128 &&
        senha.any(Char::isLowerCase) &&
        senha.any(Char::isUpperCase) &&
        senha.any(Char::isDigit)

private class SufixoVisualTransformation(private val sufixo: String) : VisualTransformation {
    override fun filter(text: AnnotatedString): TransformedText {
        if (sufixo.isEmpty() || text.isEmpty()) {
            return TransformedText(text, OffsetMapping.Identity)
        }
        val formatado = AnnotatedString(text.text + sufixo)
        val mapeamento = object : OffsetMapping {
            override fun originalToTransformed(offset: Int): Int = offset.coerceAtMost(text.length)
            override fun transformedToOriginal(offset: Int): Int = offset.coerceAtMost(text.length)
        }
        return TransformedText(formatado, mapeamento)
    }
}

@Composable
private fun RegisterForm(
    onLogin: () -> Unit,
    loading: Boolean,
    feedback: String,
    feedbackSuccess: Boolean,
    onSubmit: (String, String, String, String, String, String) -> Unit
) {
    var name by remember { mutableStateOf("") }
    var email by remember { mutableStateOf("") }
    var cpf by remember { mutableStateOf("") } // apenas dígitos
    var crm by remember { mutableStateOf("") } // apenas dígitos
    var uf by remember { mutableStateOf("") }
    var password by remember { mutableStateOf("") }
    var confirm by remember { mutableStateOf("") }
    var visible by remember { mutableStateOf(false) }
    var formError by remember { mutableStateOf("") }

    // CRM guarda só dígitos; a UF aparece anexada visualmente ("123456-SP").
    val crmMascara = remember(uf) { SufixoVisualTransformation(if (uf.length == 2) "-$uf" else "") }

    AuthField("Nome completo", name, { name = it }, "Seu nome", Icons.Default.PersonOutline, KeyboardType.Text)
    Spacer(Modifier.height(16.dp))
    AuthField("E-mail", email, { email = it }, "Seu@email.com", Icons.Default.Email, KeyboardType.Email)
    Spacer(Modifier.height(16.dp))
    AuthField(
        "CPF",
        cpf,
        { entrada -> cpf = entrada.filter { it.isDigit() }.take(CPF_DIGITOS) },
        "11 dígitos",
        Icons.Default.PersonOutline,
        KeyboardType.Number
    )
    Spacer(Modifier.height(16.dp))
    AuthField(
        "CRM",
        crm,
        { entrada -> crm = entrada.filter { it.isDigit() } },
        "Ex.: 123456",
        Icons.Default.PersonOutline,
        KeyboardType.Number,
        visualTransformation = crmMascara
    )
    Spacer(Modifier.height(16.dp))
    AuthFieldDropdown(
        "UF do CRM",
        uf,
        UF_OPCOES,
        selecionar = { uf = it },
        icon = Icons.Default.PersonOutline
    )
    Spacer(Modifier.height(16.dp))
    AuthField(
        "Senha", password, { password = it }, "Crie uma senha segura", Icons.Default.Lock,
        KeyboardType.Password, password = true, visible = visible, onToggle = { visible = !visible }
    )
    Text(
        "Use de 8 a 128 caracteres, com maiúscula, minúscula e número.",
        color = Color(0xFFA9B5B4), fontSize = 10.sp, fontWeight = FontWeight.SemiBold,
        modifier = Modifier.fillMaxWidth().padding(start = 3.dp, top = 3.dp)
    )
    Spacer(Modifier.height(8.dp))
    AuthField(
        "Confirme sua senha", confirm, { confirm = it }, "Confirme sua senha", Icons.Default.Lock,
        KeyboardType.Password, password = true, visible = visible, onToggle = { visible = !visible }
    )
    Text(
        "Após o cadastro, seu CRM passa por análise manual do time Alocca.",
        color = Color(0xFFA9B5B4), fontSize = 10.sp, fontWeight = FontWeight.SemiBold,
        modifier = Modifier.fillMaxWidth().padding(start = 3.dp, top = 3.dp)
    )
    Spacer(Modifier.height(14.dp))
    if (formError.isNotBlank()) FeedbackText(formError, false)
    else if (feedback.isNotBlank()) FeedbackText(feedback, feedbackSuccess)
    PrimaryButton("Cadastrar", loading) {
        formError = when {
            name.trim().length < 2 -> "Informe seu nome completo (mínimo 2 caracteres)."
            !email.trim().matches(Regex("^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$")) -> "Informe um e-mail válido."
            !cpfValido(cpf) -> "Informe um CPF válido (11 dígitos)."
            crm.isBlank() -> "Informe o número do CRM."
            crm.length > CRM_DIGITOS_MAX -> "O CRM deve ter no máximo 20 dígitos."
            uf !in UF_OPCOES.map(Pair<String, String>::first) -> "Informe uma UF válida para o CRM."
            !senhaAtendeRn05(password) -> "A senha deve ter de 8 a 128 caracteres, com maiúscula, minúscula e número."
            password != confirm -> "As senhas não coincidem."
            else -> ""
        }
        if (formError.isEmpty()) onSubmit(name, email, cpf, crm, uf, password)
    }
    Row(Modifier.fillMaxWidth().padding(top = 13.dp), horizontalArrangement = Arrangement.Center) {
        Text("Já tem uma conta? ", color = Muted, fontSize = 13.sp)
        Text("Faça Login", Modifier.clickable(onClick = onLogin), color = Border, fontWeight = FontWeight.Bold, fontSize = 13.sp)
    }
}

// UFs com conselho regional (27), ordem alfabética por sigla.
private val UF_OPCOES: List<Pair<String, String>> = listOf(
    "AC" to "Acre", "AL" to "Alagoas", "AP" to "Amapá", "AM" to "Amazonas",
    "BA" to "Bahia", "CE" to "Ceará", "DF" to "Distrito Federal", "ES" to "Espírito Santo",
    "GO" to "Goiás", "MA" to "Maranhão", "MT" to "Mato Grosso", "MS" to "Mato Grosso do Sul",
    "MG" to "Minas Gerais", "PA" to "Pará", "PB" to "Paraíba", "PR" to "Paraná",
    "PE" to "Pernambuco", "PI" to "Piauí", "RJ" to "Rio de Janeiro", "RN" to "Rio Grande do Norte",
    "RS" to "Rio Grande do Sul", "RO" to "Rondônia", "RR" to "Roraima", "SC" to "Santa Catarina",
    "SP" to "São Paulo", "SE" to "Sergipe", "TO" to "Tocantins",
)

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun AuthFieldDropdown(
    label: String,
    value: String,
    opcoes: List<Pair<String, String>>,
    selecionar: (String) -> Unit,
    icon: androidx.compose.ui.graphics.vector.ImageVector,
) {
    var expandido by remember { mutableStateOf(false) }
    ExposedDropdownMenuBox(
        expanded = expandido,
        onExpandedChange = { expandido = it },
        modifier = Modifier.fillMaxWidth()
    ) {
        Box(
            modifier = Modifier
                .fillMaxWidth()
                .height(52.dp)
        ) {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .height(44.dp)
                    .align(Alignment.BottomCenter)
                    .clip(RoundedCornerShape(8.dp))
                    .background(CanvasColor)
                    .border(width = 1.dp, color = Border, shape = RoundedCornerShape(8.dp))
                    .padding(horizontal = 11.dp)
                    .menuAnchor(MenuAnchorType.PrimaryNotEditable),
                verticalAlignment = Alignment.CenterVertically
            ) {
                Icon(
                    imageVector = icon,
                    contentDescription = null,
                    tint = Border,
                    modifier = Modifier.size(19.dp)
                )
                Spacer(Modifier.width(12.dp))
                Text(
                    text = value.ifBlank { "UF" },
                    color = if (value.isBlank()) Color(0xFFAAB7B6) else Navy,
                    fontSize = 13.sp,
                    fontWeight = FontWeight.SemiBold
                )
                Spacer(Modifier.weight(1f))
                Icon(
                    imageVector = Icons.Default.KeyboardArrowDown,
                    contentDescription = "Abrir lista de UFs",
                    tint = Border,
                    modifier = Modifier.size(20.dp)
                )
            }

            Text(
                text = label,
                color = Border,
                fontSize = 13.sp,
                fontWeight = FontWeight.SemiBold,
                modifier = Modifier
                    .align(Alignment.TopStart)
                    .padding(start = 14.dp)
                    .background(CanvasColor)
                    .padding(horizontal = 4.dp)
            )

            ExposedDropdownMenu(
                expanded = expandido,
                onDismissRequest = { expandido = false },
                modifier = Modifier.exposedDropdownSize()
            ) {
                opcoes.forEach { (sigla, nome) ->
                    DropdownMenuItem(
                        text = {
                            Text("$nome ($sigla)", color = Navy, fontSize = 13.sp, maxLines = 1)
                        },
                        onClick = {
                            selecionar(sigla)
                            expandido = false
                        }
                    )
                }
            }
        }
    }
}

@Composable
private fun AuthField(
    label: String,
    value: String,
    onValueChange: (String) -> Unit,
    placeholder: String,
    icon: androidx.compose.ui.graphics.vector.ImageVector,
    keyboard: KeyboardType,
    password: Boolean = false,
    visible: Boolean = false,
    onToggle: (() -> Unit)? = null,
    visualTransformation: VisualTransformation = VisualTransformation.None
) {
    // Campo desenhado manualmente para reproduzir o protótipo:
    // borda fina, rótulo sobre a borda e placeholder visível.
    Box(
        modifier = Modifier
            .fillMaxWidth()
            .height(52.dp)
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .height(44.dp)
                .align(Alignment.BottomCenter)
                .clip(RoundedCornerShape(8.dp))
                .background(CanvasColor)
                .border(
                    width = 1.dp,
                    color = Border,
                    shape = RoundedCornerShape(8.dp)
                )
                .padding(horizontal = 11.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Icon(
                imageVector = icon,
                contentDescription = null,
                tint = Border,
                modifier = Modifier.size(19.dp)
            )

            Spacer(Modifier.width(12.dp))

            androidx.compose.foundation.text.BasicTextField(
                value = value,
                onValueChange = onValueChange,
                singleLine = true,
                textStyle = androidx.compose.ui.text.TextStyle(
                    color = Navy,
                    fontSize = 13.sp
                ),
                visualTransformation = if (password && !visible) {
                    PasswordVisualTransformation()
                } else {
                    visualTransformation
                },
                keyboardOptions = KeyboardOptions(keyboardType = keyboard),
                decorationBox = { innerTextField ->
                    Box(Modifier.fillMaxWidth()) {
                        if (value.isEmpty()) {
                            Text(
                                text = placeholder,
                                color = Color(0xFFAAB7B6),
                                fontSize = 13.sp,
                                fontWeight = FontWeight.SemiBold
                            )
                        }
                        innerTextField()
                    }
                },
                modifier = Modifier.weight(1f)
            )

            if (password && onToggle != null) {
                Spacer(Modifier.width(8.dp))
                Icon(
                    imageVector = if (visible) Icons.Default.VisibilityOff
                    else Icons.Default.Visibility,
                    contentDescription = if (visible) "Ocultar senha" else "Mostrar senha",
                    tint = Border,
                    modifier = Modifier
                        .size(20.dp)
                        .clickable(onClick = onToggle)
                )
            }
        }

        Text(
            text = label,
            color = Border,
            fontSize = 13.sp,
            fontWeight = FontWeight.SemiBold,
            modifier = Modifier
                .align(Alignment.TopStart)
                .padding(start = 14.dp)
                .background(CanvasColor)
                .padding(horizontal = 4.dp)
        )
    }
}

@Composable
private fun FeedbackText(text: String, success: Boolean) {
    Text(
        text = text,
        modifier = Modifier.fillMaxWidth().padding(top = 8.dp),
        color = if (success) Color(0xFF18794E) else Color(0xFFB3261E),
        fontSize = 12.sp,
        textAlign = TextAlign.Start
    )
}

@Composable
private fun PrimaryButton(text: String, loading: Boolean = false, onClick: () -> Unit = {}) {
    Button(
        onClick = onClick,
        enabled = !loading,
        modifier = Modifier.fillMaxWidth().height(48.dp),
        shape = RoundedCornerShape(7.dp),
        colors = ButtonDefaults.buttonColors(containerColor = DeepTeal),
        elevation = ButtonDefaults.buttonElevation(defaultElevation = 3.dp)
    ) {
        if (loading) CircularProgressIndicator(modifier = Modifier.size(18.dp), color = Color.White, strokeWidth = 2.dp)
        else Text(text, color = Color.White, fontSize = 13.sp, fontWeight = FontWeight.Bold)
    }
}

@Composable
private fun PrivacyCard() {
    Row(
        Modifier.fillMaxWidth()
            .clip(RoundedCornerShape(8.dp))
            .background(Color(0xFFD3E9EA))
            .padding(12.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Text("⬡", color = Color(0xFF36BCE0), fontSize = 34.sp, fontWeight = FontWeight.Bold)
        Spacer(Modifier.width(10.dp))
        Column {
            Text("Segurança e privacidade", color = Color.Black, fontSize = 11.sp, fontWeight = FontWeight.Bold)
            Text(
                "Seus dados estão protegidos. Utilizamos criptografia e seguimos a LGPD.",
                color = Muted, fontSize = 11.sp, lineHeight = 14.sp
            )
        }
    }
}
