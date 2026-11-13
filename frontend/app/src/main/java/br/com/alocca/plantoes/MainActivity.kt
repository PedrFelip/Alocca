package br.com.alocca.plantoes

import android.os.Bundle
import android.os.Handler
import android.os.Looper
import androidx.activity.ComponentActivity
import androidx.activity.compose.BackHandler
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
import androidx.compose.material.icons.filled.ChevronRight
import androidx.compose.material.icons.filled.EventNote
import androidx.compose.material.icons.filled.Groups
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
import java.util.Calendar
import java.util.Locale

internal val Navy = Color(0xFF063957)
internal val DeepTeal = Color(0xFF07566A)
internal val Cyan = Color(0xFF09A9CE)
internal val Muted = Color(0xFF657775)
private val CanvasColor = Color(0xFFF3F9F8)
private val Border = Color(0xFF48A8BC)

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

private enum class Screen { Login, Register, EsqueciSenha }
private enum class QuickActionScreen { Security, Calendar, Profile, Workplaces }
private enum class InstitutionScreen { Home, Shifts, Doctors, Payments, TimeRecord, Settings, PublishShift }

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

    // voltar do celular na tela de esqueci a senha volta pro login em vez de fechar o app
    BackHandler(enabled = perfil == null && screen == Screen.EsqueciSenha) {
        feedback = ""
        screen = Screen.Login
    }

    fun expirarSessao() {
        TokenStore.clear(context)
        perfil = null
        screen = Screen.Login
        feedback = "Sua sessão expirou. Entre novamente."
        feedbackSuccess = false
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
                if (currentPerfil.tipo == "GESTOR") {
                    InstitutionApp(currentPerfil, onLogout = ::logout)
                } else {
                    CompositionLocalProvider(LocalSessaoExpirada provides ::expirarSessao) {
                        HomeScreen(currentPerfil, onLogout = ::logout, onPerfilAtualizado = { perfil = it })
                    }
                }
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
                            onEsqueciSenha = { feedback = ""; screen = Screen.EsqueciSenha },
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
                    } else if (screen == Screen.EsqueciSenha) {
                        Spacer(Modifier.height(10.dp))
                        Text("Esqueceu sua senha?", color = Navy, fontSize = 23.sp, fontWeight = FontWeight.Medium)
                        Spacer(Modifier.height(6.dp))
                        Text(
                            "Informe seu e-mail para receber\num link de redefinição.",
                            color = Muted,
                            fontSize = 13.sp,
                            lineHeight = 17.sp,
                            textAlign = TextAlign.Center
                        )
                        Spacer(Modifier.height(24.dp))
                        EsqueciSenhaForm(onLogin = { feedback = ""; screen = Screen.Login })
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
private fun HomeScreen(perfil: PerfilUsuario, onLogout: () -> Unit, onPerfilAtualizado: (PerfilUsuario) -> Unit = {}) {
    var activeTab by remember { mutableStateOf("Início") }
    var notificationsOpen by remember { mutableStateOf(false) }
    var quickActionScreen by remember { mutableStateOf<QuickActionScreen?>(null) }
    var confirmandoSaida by remember { mutableStateOf(false) }
    val primeiroNome = perfil.nome.trim().split(" ").firstOrNull { it.isNotBlank() && !it.endsWith(".") } ?: "Doutor(a)"
    val pedirSaida = { confirmandoSaida = true }

    // Diálogo antes de qualquer retorno antecipado: vale para todas as abas.
    if (confirmandoSaida) {
        AlertDialog(
            onDismissRequest = { confirmandoSaida = false },
            title = { Text("Sair da conta?") },
            text = { Text("Você precisará entrar novamente para acessar seus plantões.") },
            confirmButton = { TextButton(onClick = { confirmandoSaida = false; onLogout() }) { Text("Sair", color = Color(0xFFE53935)) } },
            dismissButton = { TextButton(onClick = { confirmandoSaida = false }) { Text("Cancelar") } },
        )
    }

    BackHandler(enabled = quickActionScreen != null || activeTab != "Início") {
        if (quickActionScreen != null) quickActionScreen = null else activeTab = "Início"
    }

    val onQuickTabSelected: (String) -> Unit = { selected ->
        quickActionScreen = null
        activeTab = selected
    }
    when (quickActionScreen) {
        QuickActionScreen.Security -> { SecurityScreen(onBack = { quickActionScreen = null }, onTabSelected = onQuickTabSelected); return }
        QuickActionScreen.Calendar -> { CalendarScreen(onBack = { quickActionScreen = null }, onTabSelected = onQuickTabSelected); return }
        QuickActionScreen.Profile -> { ProfileScreen(perfil = perfil, onBack = { quickActionScreen = null }, onTabSelected = onQuickTabSelected, onPerfilAtualizado = onPerfilAtualizado); return }
        QuickActionScreen.Workplaces -> { WorkplacesScreen(onBack = { quickActionScreen = null }, onTabSelected = onQuickTabSelected); return }
        null -> Unit
    }

    if (activeTab == "Configurações") {
        SettingsScreen(perfil = perfil, onTabSelected = { activeTab = it }, onLogout = pedirSaida, onAbrirPerfil = { quickActionScreen = QuickActionScreen.Profile }, onAbrirSeguranca = { quickActionScreen = QuickActionScreen.Security })
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
                    onLogout = pedirSaida,
                )
                // Cada aba tem seu próprio scroll (key), para não herdar a posição da anterior.
                key(activeTab) {
                    Column(
                        modifier = Modifier
                            .weight(1f)
                            .verticalScroll(rememberScrollState())
                            .padding(horizontal = 20.dp),
                    ) {
                        Spacer(Modifier.height(16.dp))
                        when (activeTab) {
                            "Buscar" -> BuscarConteudo(perfil)
                            "Plantões" -> MeusPlantoesConteudo(onBuscar = { activeTab = "Buscar" })
                            "Financeiro" -> FinanceiroConteudo()
                            else -> {
                                Text("Olá, $primeiroNome", color = Navy, fontSize = 20.sp, fontWeight = FontWeight.Bold)
                                Spacer(Modifier.height(3.dp))
                                Text(
                                    "Encontre plantões, acompanhe suas\natividades e gerencie seus plantões.",
                                    color = Navy,
                                    fontSize = 13.sp,
                                    lineHeight = 16.sp,
                                )
                                Spacer(Modifier.height(16.dp))
                                InicioConteudo(perfil, onVerPlantoes = { activeTab = "Plantões" }, onBuscar = { activeTab = "Buscar" })
                                Spacer(Modifier.height(18.dp))
                                Text("Ações rápidas", color = Navy, fontSize = 14.sp, fontWeight = FontWeight.Bold)
                                Spacer(Modifier.height(10.dp))
                                QuickActions { action ->
                                    quickActionScreen = when (action) {
                                        "Segurança" -> QuickActionScreen.Security
                                        "Calendário" -> QuickActionScreen.Calendar
                                        "Locais de trabalho" -> QuickActionScreen.Workplaces
                                        "Seu perfil" -> QuickActionScreen.Profile
                                        else -> null
                                    }
                                }
                            }
                        }
                        Spacer(Modifier.height(22.dp))
                    }
                }
                HomeBottomNavigation(activeTab, onSelected = { selected -> activeTab = selected })
            }

            AnimatedVisibility(
                visible = notificationsOpen,
                modifier = Modifier.align(Alignment.TopEnd).statusBarsPadding().padding(top = 68.dp, end = 16.dp),
                enter = expandIn(expandFrom = Alignment.TopEnd) + fadeIn(),
                exit = shrinkOut(shrinkTowards = Alignment.TopEnd) + fadeOut(),
            ) {
                NotificationsPanel(onClose = { notificationsOpen = false })
            }
        }
    }
}

@Composable
internal fun CalendarLegend(color: Color, label: String) {
    Row(verticalAlignment = Alignment.CenterVertically) {
        Box(modifier = Modifier.size(7.dp).clip(androidx.compose.foundation.shape.CircleShape).background(color))
        Spacer(Modifier.width(3.dp))
        Text(label, color = Color(0xFF2D3137), fontSize = 9.sp)
    }
}

@Composable
private fun SecurityScreen(onBack: () -> Unit, onTabSelected: (String) -> Unit) {
    Surface(modifier = Modifier.fillMaxSize(), color = Color.White) {
        Column(modifier = Modifier.fillMaxSize().statusBarsPadding().navigationBarsPadding()) {
            QuickActionHeader("Segurança", onBack)
            Column(
                modifier = Modifier.weight(1f).verticalScroll(rememberScrollState()).padding(horizontal = 18.dp),
            ) {
                Spacer(Modifier.height(22.dp))
                Text("Segurança da conta", color = Navy, fontSize = 20.sp, fontWeight = FontWeight.Bold)
                Spacer(Modifier.height(4.dp))
                Text("Mantenha o acesso à sua conta protegido.", color = Muted, fontSize = 13.sp)
                Spacer(Modifier.height(18.dp))
                SecurityStatusCard()
                Spacer(Modifier.height(22.dp))
                Text("Alterar senha", color = Navy, fontSize = 16.sp, fontWeight = FontWeight.Bold)
                Spacer(Modifier.height(6.dp))
                // Sem rota de troca de senha no backend ainda (chega junto com a UC04).
                EstadoVazio("A troca de senha pelo aplicativo ainda não está disponível. Ela será liberada junto com a recuperação de senha.")
                Spacer(Modifier.height(24.dp))
                Text("Sessão", color = Navy, fontSize = 16.sp, fontWeight = FontWeight.Bold)
                Spacer(Modifier.height(9.dp))
                SecurityInfoRow("Sessão atual", "Este dispositivo • token armazenado com criptografia", Icons.Default.PersonOutline)
                Spacer(Modifier.height(8.dp))
                SecurityInfoRow("Proteção de login", "Conta bloqueada por 15 min após tentativas inválidas", Icons.Default.Lock)
                Spacer(Modifier.height(22.dp))
            }
            HomeBottomNavigation("Configurações", onSelected = onTabSelected)
        }
    }
}

@Composable
internal fun QuickActionHeader(title: String, onBack: () -> Unit) {
    Row(
        modifier = Modifier.fillMaxWidth().height(56.dp).border(1.dp, Color(0xFFE0E5E5)).padding(horizontal = 16.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text("‹", color = Navy, fontSize = 30.sp, modifier = Modifier.clickable(onClick = onBack).padding(end = 9.dp))
        Text(title, color = Navy, fontSize = 17.sp, fontWeight = FontWeight.Bold)
    }
}

@Composable
private fun SecurityStatusCard() {
    Row(
        modifier = Modifier.fillMaxWidth().clip(RoundedCornerShape(14.dp)).background(Color(0xFFE9F8F3)).border(1.dp, Color(0xFFC4ECDD), RoundedCornerShape(14.dp)).padding(15.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(modifier = Modifier.size(42.dp).clip(androidx.compose.foundation.shape.CircleShape).background(Color(0xFF13A66B)), contentAlignment = Alignment.Center) {
            Icon(Icons.Default.Security, null, tint = Color.White, modifier = Modifier.size(24.dp))
        }
        Spacer(Modifier.width(12.dp))
        Column {
            Text("Sua conta está protegida", color = Color(0xFF087A4D), fontSize = 14.sp, fontWeight = FontWeight.Bold)
            Text("Senha e acesso verificados.", color = Muted, fontSize = 11.sp)
        }
    }
}

@Composable
private fun SecurityInfoRow(title: String, detail: String, icon: androidx.compose.ui.graphics.vector.ImageVector) {
    Row(
        modifier = Modifier.fillMaxWidth().clip(RoundedCornerShape(10.dp)).border(1.dp, Color(0xFFE0E5E5), RoundedCornerShape(10.dp)).padding(12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(icon, null, tint = DeepTeal, modifier = Modifier.size(22.dp))
        Spacer(Modifier.width(12.dp))
        Column {
            Text(title, color = Navy, fontSize = 12.sp, fontWeight = FontWeight.SemiBold)
            Text(detail, color = Muted, fontSize = 10.sp)
        }
    }
}

@Composable
internal fun AttendanceTopBar() {
    Row(modifier = Modifier.fillMaxWidth().height(82.dp).background(Brush.horizontalGradient(listOf(Color(0xFF0B2E63), Color(0xFF134987)))).padding(horizontal = 19.dp), verticalAlignment = Alignment.CenterVertically) {
        Image(painter = painterResource(id = R.drawable.alocca_hotbar_mark), contentDescription = null, modifier = Modifier.size(36.dp))
        Spacer(Modifier.width(8.dp))
        Column {
            Text("Alocca", color = Color.White, fontSize = 18.sp, fontWeight = FontWeight.Bold)
            Text("Plantões", color = Color(0xFFAFC9EC), fontSize = 13.sp)
        }
        Spacer(Modifier.weight(1f))
        Icon(Icons.Default.NotificationsNone, "Notificações", tint = Color.White, modifier = Modifier.size(24.dp))
    }
}

@Composable
internal fun AttendanceDetail(label: String, value: String, icon: androidx.compose.ui.graphics.vector.ImageVector) {
    Row(verticalAlignment = Alignment.CenterVertically) {
        Icon(icon, null, tint = Color(0xFF6281AC), modifier = Modifier.size(23.dp))
        Spacer(Modifier.width(12.dp))
        Column {
            Text(label, color = Color(0xFF6E84A6), fontSize = 10.sp)
            Text(value, color = Navy, fontSize = 12.sp, fontWeight = FontWeight.SemiBold)
        }
    }
}

private data class InstitutionShift(
    val status: String,
    val hospital: String,
    val specialty: String,
    val date: String,
    val vacancies: String,
    val value: String,
)

@Composable
private fun InstitutionApp(perfil: PerfilUsuario, onLogout: () -> Unit) {
    var screen by remember { mutableStateOf(InstitutionScreen.Home) }
    var notificationsOpen by remember { mutableStateOf(false) }
    val open: (InstitutionScreen) -> Unit = { screen = it }
    Box(Modifier.fillMaxSize()) {
        when (screen) {
            InstitutionScreen.Home -> InstitutionHomeScreen(perfil.nome, open) { notificationsOpen = !notificationsOpen }
            InstitutionScreen.Shifts -> InstitutionShiftsScreen(open)
            InstitutionScreen.Doctors -> InstitutionDoctorsScreen(open)
            InstitutionScreen.Payments -> InstitutionPaymentsScreen(open)
            InstitutionScreen.TimeRecord -> InstitutionTimeRecordScreen(open)
            InstitutionScreen.Settings -> InstitutionSettingsScreen(perfil, open, onLogout) { notificationsOpen = !notificationsOpen }
            InstitutionScreen.PublishShift -> PublishShiftScreen(
                onBack = { screen = InstitutionScreen.Shifts },
                onPublished = { screen = InstitutionScreen.Shifts },
                onNavigate = open,
            )
        }
        AnimatedVisibility(
            visible = notificationsOpen,
            modifier = Modifier.align(Alignment.TopEnd).statusBarsPadding().padding(top = 52.dp, end = 15.dp),
            enter = expandIn(expandFrom = Alignment.TopEnd) + fadeIn(),
            exit = shrinkOut(shrinkTowards = Alignment.TopEnd) + fadeOut(),
        ) { NotificationsPanel(onClose = { notificationsOpen = false }) }
    }
}

@Composable
private fun InstitutionHomeScreen(name: String, onNavigate: (InstitutionScreen) -> Unit, onNotification: () -> Unit) {
    var selectedShift by remember { mutableStateOf<InstitutionShift?>(null) }
    InstitutionPage(InstitutionScreen.Home, onNavigate) {
        // Reutiliza exatamente o cabeçalho do fluxo médico: menu, marca e sino.
        HomeHeader(onNotification = onNotification, onLogout = {})
        Column(modifier = Modifier.weight(1f).verticalScroll(rememberScrollState()).padding(horizontal = 16.dp)) {
            Spacer(Modifier.height(15.dp))
            Text("Olá, Gestor!", color = Navy, fontSize = 18.sp, fontWeight = FontWeight.Bold)
            Text("Confira o resumo da sua instituição e\ngerencie seus plantões.", color = Color(0xFF45617D), fontSize = 12.sp, lineHeight = 15.sp)
            Spacer(Modifier.height(12.dp))
            ManagerSummary()
            Spacer(Modifier.height(15.dp))
            SectionTitle("Plantões recentes", "Ver todos") { onNavigate(InstitutionScreen.Shifts) }
            Spacer(Modifier.height(8.dp))
            InstitutionShiftCard(InstitutionShift("AGUARDANDO PAGAMENTO", "UTI Adulto", "Hospital Santa Clara", "Hoje • 19:00 - 07:00", "10/10 vagas preenchidas", "")) { selectedShift = it }
            Spacer(Modifier.height(8.dp))
            InstitutionShiftCard(InstitutionShift("EM ANDAMENTO", "Clínica Médica", "Hospital Santa Clara", "Hoje • 19:00 - 07:00", "7/10 vagas preenchidas", "")) { selectedShift = it }
            Spacer(Modifier.height(8.dp))
            InstitutionShiftCard(InstitutionShift("FINALIZADO", "Pediatria", "Hospital Santa Clara", "Hoje • 19:00 - 07:00", "10/10 vagas preenchidas", "")) { selectedShift = it }
            Spacer(Modifier.height(12.dp))
            Text("Ver mais", color = Cyan, fontSize = 12.sp, fontWeight = FontWeight.Bold, modifier = Modifier.fillMaxWidth().clickable { onNavigate(InstitutionScreen.Shifts) }.padding(vertical = 3.dp), textAlign = TextAlign.Center)
            Spacer(Modifier.height(10.dp))
            Row(modifier = Modifier.fillMaxWidth().height(61.dp).clip(RoundedCornerShape(12.dp)).background(Color(0xFFE2F2FF)).border(1.dp, Color(0xFF6AAEEC), RoundedCornerShape(12.dp)).clickable { onNavigate(InstitutionScreen.PublishShift) }.padding(horizontal = 13.dp), verticalAlignment = Alignment.CenterVertically) {
                Box(modifier = Modifier.size(42.dp).clip(androidx.compose.foundation.shape.CircleShape).background(Color(0xFF1265A8)), contentAlignment = Alignment.Center) { Text("+", color = Color.White, fontSize = 34.sp, lineHeight = 34.sp) }
                Spacer(Modifier.width(12.dp))
                Column(modifier = Modifier.weight(1f)) { Text("Publicar novo plantão", color = Navy, fontSize = 14.sp, fontWeight = FontWeight.Bold); Text("Defina a especialidade, data, horário, vagas\ne valor do plantão.", color = Color(0xFF45617D), fontSize = 10.sp, lineHeight = 12.sp) }
                Text("›", color = Color(0xFF1265A8), fontSize = 24.sp, fontWeight = FontWeight.Bold)
            }
            Spacer(Modifier.height(18.dp))
        }
        ManagerBottomNavigation(InstitutionScreen.Home, onNavigate)
        selectedShift?.let { InstitutionShiftDetailsDialog(it) { selectedShift = null } }
    }
}

@Composable
private fun InstitutionPage(active: InstitutionScreen, onNavigate: (InstitutionScreen) -> Unit, content: @Composable ColumnScope.() -> Unit) {
    Surface(modifier = Modifier.fillMaxSize(), color = Color(0xFFF9FBFD)) {
        Column(modifier = Modifier.fillMaxSize().statusBarsPadding().navigationBarsPadding(), content = content)
        // A navegação é renderizada pelo conteúdo para preservar a área rolável de cada tela.
    }
}

@Composable
private fun ManagerHeader() {
    Row(modifier = Modifier.fillMaxWidth().height(55.dp).background(Color.White).border(1.dp, Color(0xFFE0E7ED)).padding(horizontal = 16.dp), verticalAlignment = Alignment.CenterVertically) {
        Icon(Icons.Default.Menu, null, tint = Navy, modifier = Modifier.size(24.dp))
        Spacer(Modifier.width(18.dp))
        Image(painter = painterResource(id = R.drawable.alocca_logo), contentDescription = "Alocca Plantões", modifier = Modifier.width(105.dp).height(40.dp))
        Spacer(Modifier.weight(1f))
        Box(modifier = Modifier.size(30.dp), contentAlignment = Alignment.Center) { Icon(Icons.Default.NotificationsNone, null, tint = Navy, modifier = Modifier.size(22.dp)); Text("3", color = Color.White, fontSize = 8.sp, modifier = Modifier.align(Alignment.TopEnd).clip(androidx.compose.foundation.shape.CircleShape).background(Cyan).padding(horizontal = 4.dp, vertical = 1.dp)) }
    }
}

@Composable
private fun ManagerSummary() {
    Column(modifier = Modifier.fillMaxWidth().clip(RoundedCornerShape(10.dp)).background(Color(0xFF0B3A76)).padding(10.dp)) {
        Text("Resumo rápido", color = Color.White, fontSize = 10.sp, fontWeight = FontWeight.Bold)
        Spacer(Modifier.height(6.dp))
        Row(horizontalArrangement = Arrangement.SpaceEvenly, modifier = Modifier.fillMaxWidth()) {
            ManagerSummaryItem(Icons.Default.EventNote, Color(0xFF316B9E), "3", "Plantões\npublicados")
            ManagerSummaryItem(Icons.Default.Groups, Color(0xFF009A7B), "67", "Médicos\ncadastrados")
            ManagerSummaryItem(Icons.Default.AccountBalanceWallet, Color(0xFF7564A9), "R$24.359", "Total em\npagamentos")
            ManagerSummaryItem(Icons.Default.PersonOutline, Color(0xFFF5A600), "32", "Vagas\npreenchidas")
        }
    }
}

@Composable
private fun ManagerSummaryItem(
    icon: androidx.compose.ui.graphics.vector.ImageVector,
    iconBackground: Color,
    value: String,
    label: String,
) {
    // Mesmo ritmo visual dos indicadores da home do Médico, com ícones Material.
    Column(
        modifier = Modifier.width(64.dp).clip(RoundedCornerShape(8.dp)).background(Color(0xFF21528C)).padding(vertical = 7.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Box(modifier = Modifier.size(29.dp).clip(RoundedCornerShape(8.dp)).background(iconBackground), contentAlignment = Alignment.Center) {
            Icon(icon, contentDescription = null, tint = Color.White, modifier = Modifier.size(18.dp))
        }
        Spacer(Modifier.height(5.dp))
        Text(value, color = Color.White, fontSize = 9.sp, fontWeight = FontWeight.Bold, maxLines = 1)
        Spacer(Modifier.height(2.dp))
        Text(label, color = Color.White, fontSize = 8.sp, lineHeight = 10.sp, textAlign = TextAlign.Center, modifier = Modifier.height(20.dp))
    }
}

@Composable
private fun InstitutionShiftCard(shift: InstitutionShift, onClick: (InstitutionShift) -> Unit = {}) {
    Row(modifier = Modifier.fillMaxWidth().clip(RoundedCornerShape(12.dp)).background(Color.White).border(1.dp, Color(0xFFD4DCE2), RoundedCornerShape(12.dp)).clickable { onClick(shift) }.padding(10.dp), verticalAlignment = Alignment.CenterVertically) {
        Column(modifier = Modifier.width(62.dp).height(76.dp).clip(RoundedCornerShape(11.dp)).background(Color(0xFFD9F4FF)), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.Center) { Text("20", color = Navy, fontSize = 18.sp, fontWeight = FontWeight.Bold); Text("JUN", color = Navy, fontSize = 11.sp, fontWeight = FontWeight.Bold); Spacer(Modifier.height(5.dp)); Text("Sex. 19h", color = Navy, fontSize = 11.sp, fontWeight = FontWeight.Bold) }
        Spacer(Modifier.width(10.dp))
        Column(modifier = Modifier.weight(1f)) { Text(shift.status, color = Color(0xFF1287AF), fontSize = 8.sp, fontWeight = FontWeight.Bold); Text(shift.hospital, color = Navy, fontSize = 13.sp, fontWeight = FontWeight.Bold); Text(shift.specialty, color = Color(0xFF4D6681), fontSize = 10.sp); Text("♧ ${shift.vacancies}", color = Color(0xFF4D6681), fontSize = 9.sp); Text("◷ ${shift.date}", color = Color(0xFF4D6681), fontSize = 9.sp) }
        Icon(Icons.Default.ChevronRight, null, tint = Color(0xFF7390A8), modifier = Modifier.size(19.dp))
    }
}

@Composable
private fun ManagerBottomNavigation(active: InstitutionScreen, onNavigate: (InstitutionScreen) -> Unit) {
    val items = listOf(
        Triple("Início", Icons.Default.Home, InstitutionScreen.Home),
        Triple("Plantões", Icons.Default.CalendarMonth, InstitutionScreen.Shifts),
        Triple("Médicos", Icons.Default.PersonOutline, InstitutionScreen.Doctors),
        Triple("Financeiro", Icons.Default.AccountBalanceWallet, InstitutionScreen.Payments),
        Triple("Configurações", Icons.Default.Settings, InstitutionScreen.Settings),
    )
    Row(modifier = Modifier.fillMaxWidth().height(65.dp).background(Color.White).border(1.dp, Color(0xFFE0E7ED)), horizontalArrangement = Arrangement.SpaceEvenly, verticalAlignment = Alignment.CenterVertically) {
        items.forEach { (label, icon, destination) ->
            val selected = active == destination
            val centralItem = label == "Médicos"
            Column(modifier = Modifier.width(65.dp).clickable { onNavigate(destination) }, horizontalAlignment = Alignment.CenterHorizontally) {
                Box(modifier = Modifier.size(if (centralItem) 38.dp else if (selected) 37.dp else 29.dp).clip(androidx.compose.foundation.shape.CircleShape).background(if (centralItem || selected) Color(0xFF1475D1) else Color.Transparent), contentAlignment = Alignment.Center) {
                    Icon(icon, null, tint = if (centralItem || selected) Color.White else Color(0xFF152226), modifier = Modifier.size(if (centralItem) 23.dp else 21.dp))
                }
                Text(label, color = if (selected || centralItem) Color(0xFF1475D1) else Color(0xFF152226), fontSize = 8.sp, fontWeight = if (selected || centralItem) FontWeight.Bold else FontWeight.Normal, maxLines = 1)
            }
        }
    }
}

@Composable
private fun InstitutionDoctorsScreen(onNavigate: (InstitutionScreen) -> Unit) {
    val doctors = listOf(
        Triple("Dr. Carlos Mendes", "UTI Adulto", "Ativo"), Triple("Dra. Ana Souza", "Pediatria", "Ativo"),
        Triple("Dr. Rafael Lima", "Clínica Médica", "Ativo"), Triple("Dra. Juliana Alves", "Ginecologia e Obstetrícia", "Ativo"),
        Triple("Dr. Bruno Costa", "Ortopedia", "Em análise"), Triple("Dra. Larissa Gomes", "Cardiologia", "Inativo"),
    )
    var query by remember { mutableStateOf("") }
    var specialty by remember { mutableStateOf("Todas") }
    var status by remember { mutableStateOf("Todas") }
    var selectedDoctor by remember { mutableStateOf<Triple<String, String, String>?>(null) }
    val filtered = doctors.filter { doctor ->
        (query.isBlank() || listOf(doctor.first, doctor.second, "123456/DF").any { it.contains(query.trim(), ignoreCase = true) }) &&
            (specialty == "Todas" || doctor.second == specialty) && (status == "Todas" || doctor.third == status)
    }
    InstitutionPage(InstitutionScreen.Doctors, onNavigate) {
        SimpleManagerTitle("Médicos", "Gerencie os médicos cadastrados na sua instituição e visualize seus perfis.")
        Column(modifier = Modifier.weight(1f).verticalScroll(rememberScrollState()).padding(horizontal = 16.dp)) {
            OutlinedTextField(value = query, onValueChange = { query = it }, placeholder = { Text("Buscar por nome, especialidade ou CRM...") }, modifier = Modifier.fillMaxWidth(), singleLine = true)
            Spacer(Modifier.height(10.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Text("Todos", modifier = Modifier.clickable { specialty = "Todas"; status = "Todas" }.padding(8.dp))
                DoctorFilter("Especialidade", specialty, listOf("Todas") + doctors.map { it.second }.distinct()) { specialty = it }
                DoctorFilter("Situação", status, listOf("Todas", "Ativo", "Em análise", "Inativo")) { status = it }
            }
            Spacer(Modifier.height(16.dp))
            Row(modifier = Modifier.fillMaxWidth().clip(RoundedCornerShape(13.dp)).background(Color.White).border(1.dp, Color(0xFFE1E8ED), RoundedCornerShape(13.dp)).padding(vertical = 13.dp), horizontalArrangement = Arrangement.SpaceEvenly) {
                listOf("48" to "Cadastrados", "42" to "Ativos", "4" to "Em análise", "2" to "Inativos").forEach { (value, label) -> Column(horizontalAlignment = Alignment.CenterHorizontally) { Text(value, color = Navy, fontSize = 15.sp, fontWeight = FontWeight.Bold); Text(label, color = Muted, fontSize = 8.sp) } }
            }
            Spacer(Modifier.height(14.dp))
            if (filtered.isEmpty()) Text("Nenhum médico encontrado.", color = Muted)
            filtered.forEach { doctor ->
                DoctorListCard(doctor.first, doctor.second, doctor.third) { selectedDoctor = doctor }
                Spacer(Modifier.height(8.dp))
            }
            Spacer(Modifier.height(10.dp))
            InstitutionShiftsPreview(onNavigate)
            Spacer(Modifier.height(14.dp))
        }
        ManagerBottomNavigation(InstitutionScreen.Doctors, onNavigate)
        selectedDoctor?.let { doctor ->
            Dialog(onDismissRequest = { selectedDoctor = null }) {
                Surface(shape = RoundedCornerShape(18.dp), color = Color.White) {
                    Column(Modifier.padding(20.dp)) {
                        Text(doctor.first, color = Navy, fontSize = 18.sp, fontWeight = FontWeight.Bold)
                        Text(doctor.second, color = Muted)
                        Text("CRM 123456/DF", color = Muted)
                        Text(doctor.third, color = Muted)
                        Button(onClick = { selectedDoctor = null }) { Text("Voltar") }
                    }
                }
            }
        }
    }
}

@Composable
private fun SimpleManagerTitle(title: String, subtitle: String) {
    Column(modifier = Modifier.fillMaxWidth().background(Color.White).padding(horizontal = 17.dp, vertical = 14.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) { Text("‹", color = Navy, fontSize = 29.sp); Spacer(Modifier.width(9.dp)); Text(title, color = Navy, fontSize = 20.sp, fontWeight = FontWeight.Bold) }
        Spacer(Modifier.height(8.dp)); Text(subtitle, color = Color(0xFF5A718A), fontSize = 10.sp, lineHeight = 14.sp)
    }
}

@Composable
private fun ManagerSearch(placeholder: String) {
    Row(modifier = Modifier.fillMaxWidth().height(40.dp).clip(RoundedCornerShape(10.dp)).background(Color.White).border(1.dp, Color(0xFFDDE5EB), RoundedCornerShape(10.dp)).padding(horizontal = 11.dp), verticalAlignment = Alignment.CenterVertically) { Icon(Icons.Default.Search, null, tint = Color(0xFF8BA0B6), modifier = Modifier.size(19.dp)); Spacer(Modifier.width(8.dp)); Text(placeholder, color = Color(0xFF91A4B8), fontSize = 10.sp) }
}

@Composable
private fun DoctorFilter(label: String, selected: String, options: List<String>, onSelect: (String) -> Unit) {
    var expanded by remember { mutableStateOf(false) }
    Box {
        Text("$label: $selected ⌄", fontSize = 10.sp, modifier = Modifier.clickable { expanded = true }.padding(8.dp))
        DropdownMenu(expanded = expanded, onDismissRequest = { expanded = false }) {
            options.forEach { option ->
                DropdownMenuItem(text = { Text(option) }, onClick = { onSelect(option); expanded = false })
            }
        }
    }
}

@Composable
private fun DoctorListCard(name: String, specialty: String, status: String, onClick: () -> Unit) {
    val color = when (status) { "Ativo" -> Color(0xFF10B878); "Em análise" -> Color(0xFF4089EE); else -> Color(0xFFE85A76) }
    Row(modifier = Modifier.fillMaxWidth().clip(RoundedCornerShape(13.dp)).background(Color.White).border(1.dp, Color(0xFFE1E8ED), RoundedCornerShape(13.dp)).clickable(onClick = onClick).padding(12.dp), verticalAlignment = Alignment.CenterVertically) {
        Box(modifier = Modifier.size(42.dp).clip(RoundedCornerShape(10.dp)).background(Color(0xFFDDF0FF)), contentAlignment = Alignment.Center) { Icon(Icons.Default.PersonOutline, null, tint = Color(0xFF1671B7), modifier = Modifier.size(26.dp)) }
        Spacer(Modifier.width(10.dp)); Column(modifier = Modifier.weight(1f)) { Text(name, color = Navy, fontSize = 13.sp, fontWeight = FontWeight.Bold); Text("♡ $specialty", color = Color(0xFF667E96), fontSize = 10.sp); Text("▣ CRM 123456/DF", color = Color(0xFF91A3B7), fontSize = 9.sp) }
        Text("• $status", color = color, fontSize = 9.sp, fontWeight = FontWeight.Bold, modifier = Modifier.clip(RoundedCornerShape(12.dp)).background(if (status == "Ativo") Color(0xFFE0F9EF) else Color(0xFFFFEEF1)).padding(horizontal = 8.dp, vertical = 5.dp)); Spacer(Modifier.width(3.dp)); Icon(Icons.Default.ChevronRight, null, tint = Color(0xFF7C92A8), modifier = Modifier.size(18.dp))
    }
}

@Composable
private fun InstitutionPaymentsScreen(onNavigate: (InstitutionScreen) -> Unit) {
    InstitutionPage(InstitutionScreen.Payments, onNavigate) {
        SimpleManagerTitle("Pagamentos", "Acompanhe os pagamentos dos plantões, visualize o histórico e\ngerencie os valores de forma prática e segura.")
        Column(modifier = Modifier.weight(1f).verticalScroll(rememberScrollState()).padding(horizontal = 16.dp)) {
            Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                PaymentSummary("Total a pagar", "R$ 24.580,00", "12 plantões", Color(0xFFEAF5FF))
                PaymentSummary("Pagamentos\nrealizados", "R$ 18.320,00", "8 plantões", Color(0xFFEAFBF3))
                PaymentSummary("Aguardando\npagamento", "R$ 6.260,00", "4 plantões", Color(0xFFFFF4E4))
            }
            Spacer(Modifier.height(17.dp))
            Row(verticalAlignment = Alignment.CenterVertically) { Text("Pagamentos recentes", color = Navy, fontSize = 15.sp, fontWeight = FontWeight.Bold); Spacer(Modifier.weight(1f)); Text("Ver todos", color = Color(0xFF1679C3), fontSize = 11.sp, fontWeight = FontWeight.Bold) }
            Spacer(Modifier.height(10.dp))
            listOf("Dr. Carlos Mendes" to "R$ 1.800,00" to "Pago", "Dra. Ana Souza" to "R$ 1.200,00" to "Pago", "Dr. Rafael Lima" to "R$ 1.500,00" to "Aguardando", "Dra. Juliana Alves" to "R$ 1.300,00" to "Pago", "Dr. Bruno Costa" to "R$ 1.100,00" to "Aguardando").forEach { item -> PaymentCard(item.first.first, item.first.second, item.second) }
            Spacer(Modifier.height(18.dp))
        }
        ManagerBottomNavigation(InstitutionScreen.Payments, onNavigate)
    }
}

@Composable
private fun PaymentSummary(title: String, value: String, label: String, color: Color) {
    Column(modifier = Modifier.width(96.dp).height(110.dp).clip(RoundedCornerShape(11.dp)).background(color).border(1.dp, Color(0xFFD9E6ED), RoundedCornerShape(11.dp)).padding(10.dp)) { Text("◉", color = Color(0xFF1487CF), fontSize = 17.sp); Spacer(Modifier.height(7.dp)); Text(title, color = Color(0xFF647B94), fontSize = 9.sp, lineHeight = 11.sp); Spacer(Modifier.height(3.dp)); Text(value, color = Navy, fontSize = 11.sp, fontWeight = FontWeight.Bold); Text(label, color = Color(0xFF1286C4), fontSize = 9.sp, fontWeight = FontWeight.Bold) }
}

@Composable
private fun PaymentCard(name: String, value: String, status: String) {
    val paid = status == "Pago"
    Row(
        modifier = Modifier.fillMaxWidth().padding(bottom = 9.dp).clip(RoundedCornerShape(13.dp)).background(Color.White).border(1.dp, Color(0xFFE1E8ED), RoundedCornerShape(13.dp)).padding(13.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(modifier = Modifier.size(42.dp).clip(RoundedCornerShape(11.dp)).background(if (paid) Color(0xFFE4F8ED) else Color(0xFFFFF1D9)), contentAlignment = Alignment.Center) {
            Icon(Icons.Default.AccountBalanceWallet, null, tint = if (paid) Color(0xFF159B65) else Color(0xFFE18A16), modifier = Modifier.size(23.dp))
        }
        Spacer(Modifier.width(11.dp))
        Column(modifier = Modifier.weight(1f)) {
            Text(name, color = Navy, fontSize = 13.sp, fontWeight = FontWeight.Bold)
            Spacer(Modifier.height(2.dp))
            Text("UTI Adulto • Plantão de 12h", color = Color(0xFF657C96), fontSize = 10.sp)
            Text("12/09 • Hospital Santa Clara", color = Color(0xFF91A3B7), fontSize = 9.sp)
        }
        Spacer(Modifier.width(8.dp))
        Column(horizontalAlignment = Alignment.End) {
            Text(value, color = Navy, fontSize = 12.sp, fontWeight = FontWeight.Bold)
            Spacer(Modifier.height(4.dp))
            Text(status, color = if (paid) Color(0xFF139A67) else Color(0xFFE18A16), fontSize = 9.sp, fontWeight = FontWeight.Bold, modifier = Modifier.clip(RoundedCornerShape(9.dp)).background(if (paid) Color(0xFFDCF7EB) else Color(0xFFFFF0D9)).padding(horizontal = 7.dp, vertical = 4.dp))
        }
    }
}

@Composable
private fun InstitutionSettingsScreen(
    perfil: PerfilUsuario,
    onNavigate: (InstitutionScreen) -> Unit,
    onLogout: () -> Unit,
    onNotification: () -> Unit,
) {
    var appNotifications by remember { mutableStateOf(true) }
    var calendarNotifications by remember { mutableStateOf(false) }
    var emailNotifications by remember { mutableStateOf(true) }
    var selectedOption by remember { mutableStateOf<String?>(null) }
    val displayName = perfil.nome.ifBlank { "Gestor" }

    InstitutionPage(InstitutionScreen.Settings, onNavigate) {
        Column(modifier = Modifier.weight(1f).verticalScroll(rememberScrollState()).padding(horizontal = 20.dp)) {
            Spacer(Modifier.height(18.dp))
            Row(modifier = Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                Text("Configurações", color = Navy, fontSize = 20.sp, fontWeight = FontWeight.Bold)
                Spacer(Modifier.weight(1f))
                Box(modifier = Modifier.size(30.dp).clickable(onClick = onNotification), contentAlignment = Alignment.Center) {
                    Icon(Icons.Default.NotificationsNone, contentDescription = "Notificações", tint = Navy, modifier = Modifier.size(25.dp))
                    Text("3", color = Color.White, fontSize = 8.sp, fontWeight = FontWeight.Bold, modifier = Modifier.align(Alignment.TopEnd).clip(androidx.compose.foundation.shape.CircleShape).background(Cyan).padding(horizontal = 4.dp, vertical = 1.dp))
                }
            }
            Spacer(Modifier.height(16.dp))
            Row(
                modifier = Modifier.fillMaxWidth().clip(RoundedCornerShape(18.dp)).background(Color.White).border(1.dp, Color(0xFFE1E4E8), RoundedCornerShape(18.dp)).padding(12.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Box(modifier = Modifier.size(62.dp).clip(androidx.compose.foundation.shape.CircleShape).background(Color(0xFFDCEFFC)), contentAlignment = Alignment.Center) {
                    Icon(Icons.Default.PersonOutline, null, tint = Navy, modifier = Modifier.size(38.dp))
                }
                Spacer(Modifier.width(13.dp))
                Column {
                    Text(displayName, color = Navy, fontSize = 16.sp, fontWeight = FontWeight.Bold)
                    Text("Gestor da instituição", color = Color(0xFF5B718A), fontSize = 12.sp)
                    Text(perfil.email, color = Color(0xFF5B718A), fontSize = 11.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
                }
            }
            Spacer(Modifier.height(22.dp))
            SettingsSectionTitle("Conta e segurança")
            SettingsGroup {
                SettingsRow(Icons.Default.PersonOutline, Color(0xFFE5F4FF), Color(0xFF1475D1), "Dados da instituição", "Atualize os dados e contatos.") { selectedOption = "Dados da instituição" }
                SettingsDivider()
                SettingsRow(Icons.Default.Lock, Color(0xFFE8F8F0), Color(0xFF14A66B), "Segurança", "Senha, autenticação e privacidade.") { selectedOption = "Segurança" }
            }
            Spacer(Modifier.height(18.dp))
            SettingsSectionTitle("Preferências do aplicativo")
            SettingsGroup {
                SettingsToggleRow(Icons.Default.NotificationsNone, Color(0xFFE1F3FA), Color(0xFF176FAD), "Notificações", "Gerencie caso queira receber alertas.", appNotifications) { appNotifications = it }
                SettingsDivider()
                SettingsToggleRow(Icons.Default.CalendarMonth, Color(0xFFE8F7EF), Color(0xFF15A268), "Calendário", "Alertas sobre os seus plantões.", calendarNotifications) { calendarNotifications = it }
                SettingsDivider()
                SettingsToggleRow(Icons.Default.Email, Color(0xFFF2EBFC), Color(0xFF7741C4), "Notificações por e-mail", "Receba alertas também por e-mail.", emailNotifications) { emailNotifications = it }
            }
            Spacer(Modifier.height(18.dp))
            SettingsSectionTitle("Informações do sistema")
            SettingsGroup {
                SettingsRow(Icons.Default.Security, Color(0xFFF2EBFC), Color(0xFF7741C4), "Sobre o aplicativo", "Versão, termos e privacidade.") { selectedOption = "Sobre o aplicativo" }
            }
            Spacer(Modifier.height(24.dp))
            Row(
                modifier = Modifier.fillMaxWidth().clip(RoundedCornerShape(11.dp)).background(Color.White).border(1.dp, Color(0xFFE1E4E8), RoundedCornerShape(11.dp)).clickable(onClick = onLogout).padding(14.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Box(modifier = Modifier.size(37.dp).clip(RoundedCornerShape(8.dp)).background(Color(0xFFFFE8E8)), contentAlignment = Alignment.Center) { Icon(Icons.Default.Logout, null, tint = Color(0xFFE53935), modifier = Modifier.size(21.dp)) }
                Spacer(Modifier.width(12.dp))
                Text("Sair da conta", color = Color(0xFFE53935), fontSize = 13.sp, fontWeight = FontWeight.Bold)
            }
            Spacer(Modifier.height(20.dp))
        }
        ManagerBottomNavigation(InstitutionScreen.Settings, onNavigate)
        selectedOption?.let { option -> SettingsDetailsDialog(option, displayName, perfil.email) { selectedOption = null } }
    }
}

@Composable
private fun SettingsSectionTitle(title: String) {
    Text(title, color = Navy, fontSize = 15.sp, fontWeight = FontWeight.Bold, modifier = Modifier.padding(bottom = 8.dp))
}

@Composable
private fun SettingsGroup(content: @Composable ColumnScope.() -> Unit) {
    Column(modifier = Modifier.fillMaxWidth().clip(RoundedCornerShape(11.dp)).background(Color.White).border(1.dp, Color(0xFFE1E4E8), RoundedCornerShape(11.dp)), content = content)
}

@Composable
private fun SettingsDivider() = HorizontalDivider(color = Color(0xFFE9ECEF))

@Composable
private fun SettingsRow(icon: androidx.compose.ui.graphics.vector.ImageVector, background: Color, tint: Color, title: String, detail: String, onClick: () -> Unit) {
    Row(modifier = Modifier.fillMaxWidth().clickable(onClick = onClick).padding(11.dp), verticalAlignment = Alignment.CenterVertically) {
        Box(modifier = Modifier.size(38.dp).clip(RoundedCornerShape(8.dp)).background(background), contentAlignment = Alignment.Center) { Icon(icon, null, tint = tint, modifier = Modifier.size(21.dp)) }
        Spacer(Modifier.width(10.dp))
        Column(modifier = Modifier.weight(1f)) { Text(title, color = Navy, fontSize = 11.sp, fontWeight = FontWeight.Bold); Text(detail, color = Navy, fontSize = 9.sp) }
        Icon(Icons.Default.ChevronRight, null, tint = Navy, modifier = Modifier.size(20.dp))
    }
}

@Composable
private fun SettingsToggleRow(icon: androidx.compose.ui.graphics.vector.ImageVector, background: Color, tint: Color, title: String, detail: String, checked: Boolean, onCheckedChange: (Boolean) -> Unit) {
    Row(modifier = Modifier.fillMaxWidth().padding(11.dp), verticalAlignment = Alignment.CenterVertically) {
        Box(modifier = Modifier.size(38.dp).clip(RoundedCornerShape(8.dp)).background(background), contentAlignment = Alignment.Center) { Icon(icon, null, tint = tint, modifier = Modifier.size(21.dp)) }
        Spacer(Modifier.width(10.dp))
        Column(modifier = Modifier.weight(1f)) { Text(title, color = Navy, fontSize = 11.sp, fontWeight = FontWeight.Bold); Text(detail, color = Navy, fontSize = 9.sp, maxLines = 1, overflow = TextOverflow.Ellipsis) }
        Switch(checked = checked, onCheckedChange = onCheckedChange, modifier = Modifier.height(28.dp), colors = SwitchDefaults.colors(checkedThumbColor = Color.White, checkedTrackColor = Color(0xFF82F38A), uncheckedThumbColor = Color.White, uncheckedTrackColor = Color(0xFFE7E7ED)))
    }
}

@Composable
private fun SettingsDetailsDialog(title: String, name: String, email: String, onDismiss: () -> Unit) {
    var firstField by remember(title) { mutableStateOf(if (title == "Segurança") "" else name) }
    var secondField by remember(title) { mutableStateOf(if (title == "Segurança") "" else email) }
    var saved by remember { mutableStateOf(false) }
    Dialog(onDismissRequest = onDismiss) {
        Surface(shape = RoundedCornerShape(18.dp), color = Color.White, shadowElevation = 10.dp) {
            Column(modifier = Modifier.padding(20.dp)) {
                Text(title, color = Navy, fontSize = 18.sp, fontWeight = FontWeight.Bold)
                Spacer(Modifier.height(6.dp))
                Text(if (title == "Sobre o aplicativo") "Alocca Plantões • versão 1.0\nConsulte termos, privacidade e informações do sistema." else "Confira as informações abaixo e altere o que for necessário.", color = Muted, fontSize = 12.sp, lineHeight = 16.sp)
                if (title != "Sobre o aplicativo") {
                    Spacer(Modifier.height(16.dp))
                    Text(if (title == "Segurança") "Senha atual" else "Nome", color = Navy, fontSize = 11.sp, fontWeight = FontWeight.Bold)
                    OutlinedTextField(value = firstField, onValueChange = { firstField = it }, placeholder = { Text(if (title == "Segurança") "Digite sua senha atual" else "Digite o nome", fontSize = 11.sp) }, modifier = Modifier.fillMaxWidth().height(52.dp), singleLine = true, visualTransformation = if (title == "Segurança") PasswordVisualTransformation() else androidx.compose.ui.text.input.VisualTransformation.None, keyboardOptions = androidx.compose.foundation.text.KeyboardOptions(keyboardType = if (title == "Segurança") KeyboardType.Password else KeyboardType.Text), shape = RoundedCornerShape(8.dp))
                    Spacer(Modifier.height(10.dp))
                    Text(if (title == "Segurança") "Nova senha" else "E-mail ou contato", color = Navy, fontSize = 11.sp, fontWeight = FontWeight.Bold)
                    OutlinedTextField(value = secondField, onValueChange = { secondField = it }, placeholder = { Text(if (title == "Segurança") "Defina uma nova senha" else "Digite o contato", fontSize = 11.sp) }, modifier = Modifier.fillMaxWidth().height(52.dp), singleLine = true, visualTransformation = if (title == "Segurança") PasswordVisualTransformation() else androidx.compose.ui.text.input.VisualTransformation.None, keyboardOptions = androidx.compose.foundation.text.KeyboardOptions(keyboardType = if (title == "Segurança") KeyboardType.Password else KeyboardType.Text), shape = RoundedCornerShape(8.dp))
                }
                if (saved) Text("Informações salvas com sucesso.", color = Color(0xFF0B8A5D), fontSize = 11.sp, modifier = Modifier.padding(top = 12.dp))
                Spacer(Modifier.height(20.dp))
                Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    OutlinedButton(onClick = onDismiss, modifier = Modifier.weight(1f), shape = RoundedCornerShape(8.dp)) { Text("Fechar") }
                    if (title != "Sobre o aplicativo") Button(onClick = { saved = true }, modifier = Modifier.weight(1f), shape = RoundedCornerShape(8.dp), colors = ButtonDefaults.buttonColors(containerColor = Color(0xFF1475D1))) { Text("Salvar") }
                }
            }
        }
    }
}

@Composable
private fun InstitutionShiftsPreview(onNavigate: (InstitutionScreen) -> Unit) {
    var selectedShift by remember { mutableStateOf<InstitutionShift?>(null) }
    SectionTitle("Plantões recentes", "Ver todos") { onNavigate(InstitutionScreen.Shifts) }
    Spacer(Modifier.height(9.dp))
    listOf(
        InstitutionShift("EM ANDAMENTO", "Clínica Médica", "Hospital Santa Clara", "Hoje • 19:00 - 07:00", "7/10 vagas preenchidas", ""),
        InstitutionShift("AGUARDANDO PAGAMENTO", "UTI Adulto", "Hospital Santa Clara", "Amanhã • 19:00 - 07:00", "10/10 vagas preenchidas", ""),
    ).forEach { shift ->
        InstitutionShiftCard(shift) { selectedShift = it }
        Spacer(Modifier.height(8.dp))
    }
    selectedShift?.let { InstitutionShiftDetailsDialog(it) { selectedShift = null } }
}

@Composable
private fun InstitutionShiftsScreen(onNavigate: (InstitutionScreen) -> Unit) {
    var selectedShift by remember { mutableStateOf<InstitutionShift?>(null) }
    var selectedFilter by remember { mutableStateOf("Todos") }
    val shifts = listOf(
        InstitutionShift("CONFIRMADO", "Hospital Regional do Gama", "Clínica Médica", "Gama - DF • 19:00 - 07:00", "8/10 vagas preenchidas", "R$ 800,00"),
        InstitutionShift("AGUARDANDO PAGAMENTO", "Hospital Santa Marta", "Clínica Médica", "Taguatinga - DF • 19:00 - 07:00", "10/10 vagas preenchidas", "R$ 950,00"),
        InstitutionShift("CONFIRMADO", "Hospital DF Star", "Pediatria", "Brasília - DF • 19:00 - 07:00", "6/8 vagas preenchidas", "R$ 700,00"),
        InstitutionShift("FINALIZADO", "Hospital Santa Lúcia", "Clínica Médica", "Taguatinga - DF • 19:00 - 07:00", "10/10 vagas preenchidas", "R$ 650,00"),
    )
    val visibleShifts = when (selectedFilter) {
        "Ativos" -> shifts.filter { it.status == "CONFIRMADO" }
        "Aguardando" -> shifts.filter { it.status == "AGUARDANDO PAGAMENTO" }
        "Finalizados" -> shifts.filter { it.status == "FINALIZADO" }
        else -> shifts
    }
    InstitutionPage(InstitutionScreen.Shifts, onNavigate) {
        SimpleManagerTitle("Plantões", "")
        Column(modifier = Modifier.weight(1f).verticalScroll(rememberScrollState()).padding(horizontal = 16.dp)) {
            Row(modifier = Modifier.fillMaxWidth().clip(RoundedCornerShape(9.dp)).background(Color(0xFFE9F3FC))) {
                listOf("Todos", "Ativos", "Aguardando", "Finalizados").forEach { label ->
                    val selected = selectedFilter == label
                    Text(label, color = if (selected) Color.White else Color(0xFF5D7B99), fontSize = 10.sp, textAlign = TextAlign.Center, fontWeight = if (selected) FontWeight.Bold else FontWeight.Normal, modifier = Modifier.weight(1f).clip(RoundedCornerShape(9.dp)).background(if (selected) Color(0xFF1475D1) else Color.Transparent).clickable { selectedFilter = label }.padding(vertical = 9.dp))
                }
            }
            Spacer(Modifier.height(14.dp))
            visibleShifts.forEach { shift -> InstitutionShiftCard(shift) { selectedShift = it }; Spacer(Modifier.height(9.dp)) }
            Spacer(Modifier.height(8.dp)); Button(onClick = { onNavigate(InstitutionScreen.PublishShift) }, modifier = Modifier.fillMaxWidth().height(47.dp), shape = RoundedCornerShape(8.dp), colors = ButtonDefaults.buttonColors(containerColor = Color(0xFF3278B5))) { Text("Publicar plantão", fontWeight = FontWeight.Bold) }; Spacer(Modifier.height(14.dp))
        }
        ManagerBottomNavigation(InstitutionScreen.Shifts, onNavigate)
        selectedShift?.let { InstitutionShiftDetailsDialog(it) { selectedShift = null } }
    }
}

@Composable
private fun InstitutionShiftDetailsDialog(shift: InstitutionShift, onDismiss: () -> Unit) {
    Dialog(onDismissRequest = onDismiss) {
        Surface(shape = RoundedCornerShape(18.dp), color = Color.White, shadowElevation = 10.dp) {
            Column(modifier = Modifier.padding(20.dp)) {
                Text("Detalhes do plantão", color = Navy, fontSize = 18.sp, fontWeight = FontWeight.Bold)
                Spacer(Modifier.height(15.dp))
                Text(shift.hospital, color = Navy, fontSize = 16.sp, fontWeight = FontWeight.Bold)
                Text(shift.specialty, color = DeepTeal, fontSize = 12.sp, fontWeight = FontWeight.SemiBold)
                HorizontalDivider(modifier = Modifier.padding(vertical = 14.dp), color = Color(0xFFE5EBEF))
                DetailLine(Icons.Default.CalendarMonth, "Data e horário", shift.date)
                Spacer(Modifier.height(13.dp))
                DetailLine(Icons.Default.PersonOutline, "Ocupação", shift.vacancies.ifBlank { "Vagas disponíveis" })
                Spacer(Modifier.height(13.dp))
                DetailLine(Icons.Default.AccountBalanceWallet, "Status", shift.status)
                Spacer(Modifier.height(20.dp))
                Button(onClick = onDismiss, modifier = Modifier.fillMaxWidth(), shape = RoundedCornerShape(8.dp), colors = ButtonDefaults.buttonColors(containerColor = Color(0xFF1475D1))) { Text("Fechar") }
            }
        }
    }
}

@Composable
private fun PublishShiftScreen(onBack: () -> Unit, onPublished: () -> Unit, onNavigate: (InstitutionScreen) -> Unit) {
    var specialty by remember { mutableStateOf("") }
    var date by remember { mutableStateOf("") }
    var hours by remember { mutableStateOf("") }
    var location by remember { mutableStateOf("") }
    var value by remember { mutableStateOf("") }
    var vacancies by remember { mutableStateOf("") }
    var note by remember { mutableStateOf("") }
    var published by remember { mutableStateOf(false) }
    var validationMessage by remember { mutableStateOf("") }

    Surface(modifier = Modifier.fillMaxSize(), color = Color.White) {
        Column(modifier = Modifier.fillMaxSize().statusBarsPadding().navigationBarsPadding()) {
            Row(modifier = Modifier.fillMaxWidth().height(58.dp).padding(horizontal = 18.dp), verticalAlignment = Alignment.CenterVertically) {
                Text("‹", color = Navy, fontSize = 29.sp, modifier = Modifier.clickable(onClick = onBack))
                Spacer(Modifier.width(8.dp))
                Text("Publicar plantão", color = Navy, fontSize = 19.sp, fontWeight = FontWeight.Bold)
            }
            Column(modifier = Modifier.weight(1f).verticalScroll(rememberScrollState()).padding(horizontal = 18.dp)) {
                Text("Preencha as informações abaixo para\npublicar um plantão na sua instituição", color = Navy, fontSize = 11.sp, lineHeight = 14.sp)
                Spacer(Modifier.height(18.dp))
                Column(modifier = Modifier.fillMaxWidth().clip(RoundedCornerShape(8.dp)).border(1.dp, Color(0xFFD5D0DA), RoundedCornerShape(8.dp)).padding(10.dp)) {
                    PublishFormField(Icons.Default.PersonOutline, Color(0xFFE1F4FB), "Especialidade médica") { PublishTextInput(specialty, { specialty = it }, "Selecione a especialidade") }
                    PublishFormField(Icons.Default.CalendarMonth, Color(0xFFE5F4FA), "Data do plantão") { PublishTextInput(date, { date = it }, "Selecione a data") }
                    PublishFormField(Icons.Default.AccessTime, Color(0xFFE5F4FA), "Horário") {
                        Row(horizontalArrangement = Arrangement.spacedBy(7.dp)) {
                            Box(Modifier.weight(1f)) { PublishTextInput(hours, { hours = it }, "Início") }
                            Text("até", color = Navy, fontSize = 10.sp, modifier = Modifier.align(Alignment.CenterVertically))
                            Box(Modifier.weight(1f)) { PublishTextInput("", { }, "Fim") }
                        }
                    }
                    PublishFormField(Icons.Default.LocationOn, Color(0xFFE5F4FA), "Local de atuação") { PublishTextInput(location, { location = it }, "Digite o nome ou endereço da unidade") }
                    Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                        Box(Modifier.weight(1f)) { PublishFormField(Icons.Default.AccountBalanceWallet, Color(0xFFE5F4FA), "Valor do Plantão") { PublishTextInput(value, { value = it }, "R$ 0,00") } }
                        Box(Modifier.weight(1f)) { PublishFormField(Icons.Default.Groups, Color(0xFFE5F4FA), "Vagas") { PublishTextInput(vacancies, { vacancies = it }, "Ex.: 10") } }
                    }
                    PublishFormField(Icons.Default.EventNote, Color(0xFFE5F4FA), "Observações", optional = true) {
                        OutlinedTextField(value = note, onValueChange = { note = it }, placeholder = { Text("Informações adicionais sobre o plantão, como\nrequisitos, tipo de atendimento, etc.", fontSize = 9.sp, lineHeight = 11.sp) }, textStyle = androidx.compose.ui.text.TextStyle(fontSize = 11.sp, color = Navy), modifier = Modifier.fillMaxWidth().height(84.dp), shape = RoundedCornerShape(7.dp), maxLines = 4)
                    }
                }
                Spacer(Modifier.height(16.dp))
                Button(
                    onClick = {
                        if (published) {
                            onPublished()
                        } else if (listOf(specialty, date, hours, location, value, vacancies).any { it.isBlank() }) {
                            validationMessage = "Preencha os campos obrigatórios para publicar o plantão."
                        } else {
                            validationMessage = ""
                            published = true
                        }
                    },
                    modifier = Modifier.fillMaxWidth().height(48.dp),
                    shape = RoundedCornerShape(7.dp),
                    colors = ButtonDefaults.buttonColors(containerColor = Color(0xFF3779B5)),
                ) {
                    Icon(Icons.Default.EventNote, null, tint = Color.White, modifier = Modifier.size(19.dp))
                    Spacer(Modifier.width(8.dp))
                    Text(if (published) "Ver plantões publicados" else "Publicar plantão", fontSize = 16.sp, fontWeight = FontWeight.Bold)
                }
                if (validationMessage.isNotBlank()) {
                    Text(validationMessage, color = Color(0xFFB42318), fontSize = 11.sp, modifier = Modifier.fillMaxWidth().padding(top = 8.dp), textAlign = TextAlign.Center)
                }
                if (published) {
                    Text("Plantão publicado com sucesso.", color = Color(0xFF0B8A5D), fontSize = 11.sp, modifier = Modifier.fillMaxWidth().padding(top = 8.dp), textAlign = TextAlign.Center)
                }
                Spacer(Modifier.height(22.dp))
                Column(modifier = Modifier.fillMaxWidth().clickable { onNavigate(InstitutionScreen.Doctors) }, horizontalAlignment = Alignment.CenterHorizontally) {
                    Box(modifier = Modifier.size(39.dp).clip(RoundedCornerShape(7.dp)).background(Color(0xFF3779B5)), contentAlignment = Alignment.Center) { Text("+", color = Color.White, fontSize = 37.sp, lineHeight = 37.sp) }
                    Spacer(Modifier.height(8.dp))
                    Text("Convidar médicos", color = Navy, fontSize = 15.sp, fontWeight = FontWeight.Bold)
                }
                Spacer(Modifier.height(20.dp))
            }
            ManagerBottomNavigation(InstitutionScreen.Shifts, onNavigate)
        }
    }
}

@Composable
private fun PublishFormField(icon: androidx.compose.ui.graphics.vector.ImageVector, background: Color, label: String, optional: Boolean = false, content: @Composable ColumnScope.() -> Unit) {
    Row(modifier = Modifier.fillMaxWidth().padding(bottom = 10.dp), verticalAlignment = Alignment.Top) {
        Box(modifier = Modifier.size(35.dp).clip(RoundedCornerShape(7.dp)).background(background), contentAlignment = Alignment.Center) { Icon(icon, null, tint = Navy, modifier = Modifier.size(21.dp)) }
        Spacer(Modifier.width(10.dp))
        Column(modifier = Modifier.weight(1f)) {
            Row(verticalAlignment = Alignment.CenterVertically) { Text(label, color = Navy, fontSize = 11.sp, fontWeight = FontWeight.Bold, maxLines = 1); if (optional) { Spacer(Modifier.width(3.dp)); Text("(opcional)", color = Muted, fontSize = 10.sp) } }
            Spacer(Modifier.height(4.dp))
            content()
        }
    }
}

@Composable
private fun PublishTextInput(value: String, onChange: (String) -> Unit, placeholder: String) {
    OutlinedTextField(value = value, onValueChange = onChange, placeholder = { Text(placeholder, fontSize = 9.sp, maxLines = 1, overflow = TextOverflow.Ellipsis) }, singleLine = true, textStyle = androidx.compose.ui.text.TextStyle(fontSize = 11.sp, color = Navy), modifier = Modifier.fillMaxWidth().height(38.dp), shape = RoundedCornerShape(7.dp))
}

@Composable
private fun InstitutionTimeRecordScreen(onNavigate: (InstitutionScreen) -> Unit) {
    InstitutionPage(InstitutionScreen.TimeRecord, onNavigate) {
        SimpleManagerTitle("Registro de Ponto", "Registre sua entrada e saída do plantão com validação de\nhorário e geolocalização.")
        Column(modifier = Modifier.weight(1f).verticalScroll(rememberScrollState()).padding(horizontal = 16.dp)) {
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) { TimeSummary("Plantão Atual", "19:00 - 07:00", "UTI Adulto - 12h", Color(0xFFEAF5FF)); TimeSummary("Check-in (Entrada)", "18:52", "No raio do hospital\n(GPS)", Color(0xFFEAFBF3)); TimeSummary("Check-out (Saída)", "Pendente", "Previsto: 07:00", Color(0xFFFFF5E7)) }
            Spacer(Modifier.height(13.dp))
            Column(modifier = Modifier.fillMaxWidth().clip(RoundedCornerShape(10.dp)).background(Color.White).border(1.dp, Color(0xFFDCE6ED), RoundedCornerShape(10.dp)).padding(12.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically) { Box(modifier = Modifier.size(7.dp).clip(androidx.compose.foundation.shape.CircleShape).background(Color(0xFF15B879))); Spacer(Modifier.width(6.dp)); Text("Plantão em Andamento", color = Navy, fontSize = 10.sp, fontWeight = FontWeight.Bold); Spacer(Modifier.weight(1f)); Text("Em curso", color = Color(0xFF0E9C68), fontSize = 8.sp, fontWeight = FontWeight.Bold, modifier = Modifier.clip(RoundedCornerShape(8.dp)).background(Color(0xFFE0F8EB)).padding(horizontal = 6.dp, vertical = 3.dp)) }
                Spacer(Modifier.height(14.dp)); Text("⌖  Hospital Santa Clara", color = Navy, fontSize = 12.sp, fontWeight = FontWeight.Bold); Text("UTI Adulto - Leitos 01 a 10", color = Color(0xFF627A92), fontSize = 9.sp); Text("Hoje, 24 de Outubro • 19:00 às 07:00", color = Color(0xFF627A92), fontSize = 9.sp); Spacer(Modifier.height(12.dp))
                Row(modifier = Modifier.fillMaxWidth().clip(RoundedCornerShape(9.dp)).background(Color(0xFFE7F2FF)).padding(11.dp), verticalAlignment = Alignment.CenterVertically) { Column(modifier = Modifier.weight(1f)) { Text("Tempo decorrido", color = Color(0xFF5F7A9A), fontSize = 9.sp); Text("05h 42m trabalhadas", color = Navy, fontSize = 15.sp, fontWeight = FontWeight.Bold) }; Icon(Icons.Default.AccessTime, null, tint = Color(0xFF187ACC), modifier = Modifier.size(21.dp)) }
                Spacer(Modifier.height(8.dp)); Text("✓  Geolocalização validada (a 45m do hospital)", color = Color(0xFF0A9A63), fontSize = 9.sp, modifier = Modifier.fillMaxWidth().clip(RoundedCornerShape(6.dp)).background(Color(0xFFE0F8EB)).padding(7.dp)); Spacer(Modifier.height(10.dp)); Button(onClick = { }, modifier = Modifier.fillMaxWidth().height(42.dp), shape = RoundedCornerShape(8.dp), colors = ButtonDefaults.buttonColors(containerColor = Color(0xFF103D70))) { Text("▣  Registrar Check-out (Saída)", fontSize = 11.sp, fontWeight = FontWeight.Bold) }; Spacer(Modifier.height(8.dp)); OutlinedButton(onClick = { }, modifier = Modifier.fillMaxWidth().height(39.dp), shape = RoundedCornerShape(8.dp)) { Text("Solicitar Troca ou Ajuste", color = Color(0xFF45617D), fontSize = 10.sp) }
            }
            Spacer(Modifier.height(14.dp)); ManagerSearch("Buscar histórico de registros..."); Spacer(Modifier.height(10.dp)); Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) { listOf("Hoje", "Últimos 7 dias", "Pendências", "Validados").forEachIndexed { index, label -> Text(label, color = if (index == 0) Color.White else Color(0xFF5B7895), fontSize = 9.sp, modifier = Modifier.clip(RoundedCornerShape(10.dp)).background(if (index == 0) Color(0xFF1475D1) else Color(0xFFEAF2F9)).padding(horizontal = 12.dp, vertical = 7.dp)) } }
            Spacer(Modifier.height(14.dp)); Row { Text("◷  Histórico recente", color = Navy, fontSize = 12.sp, fontWeight = FontWeight.Bold); Spacer(Modifier.weight(1f)); Text("Ver histórico completo  →", color = Color(0xFF1680C6), fontSize = 9.sp) }; Spacer(Modifier.height(9.dp))
            listOf("Hospital Santa Clara" to "Em andamento", "Hospital Santa Clara" to "Concluído", "Hospital Memorial" to "Concluído").forEach { TimeHistoryCard(it.first, it.second); Spacer(Modifier.height(8.dp)) }
            Spacer(Modifier.height(8.dp))
            InstitutionShiftsPreview(onNavigate)
            Spacer(Modifier.height(12.dp))
        }
        ManagerBottomNavigation(InstitutionScreen.TimeRecord, onNavigate)
    }
}

@Composable
private fun TimeSummary(title: String, main: String, subtitle: String, color: Color) { Column(modifier = Modifier.width(96.dp).height(99.dp).clip(RoundedCornerShape(11.dp)).background(color).border(1.dp, Color(0xFFD9E6ED), RoundedCornerShape(11.dp)).padding(10.dp)) { Text("◷", color = Color(0xFF1687CD), fontSize = 16.sp); Spacer(Modifier.height(6.dp)); Text(title, color = Color(0xFF607A94), fontSize = 8.sp); Text(main, color = Navy, fontSize = 11.sp, fontWeight = FontWeight.Bold); Text(subtitle, color = if (title == "Check-in (Entrada)") Color(0xFF129862) else Color(0xFF54708A), fontSize = 8.sp, lineHeight = 10.sp) } }

@Composable
private fun TimeHistoryCard(hospital: String, status: String) { Row(modifier = Modifier.fillMaxWidth().clip(RoundedCornerShape(11.dp)).background(Color.White).border(1.dp, Color(0xFFE1E9EF), RoundedCornerShape(11.dp)).padding(12.dp), verticalAlignment = Alignment.CenterVertically) { Box(modifier = Modifier.size(34.dp).clip(androidx.compose.foundation.shape.CircleShape).background(if (status == "Concluído") Color(0xFFE1F9ED) else Color(0xFFE7F2FF)), contentAlignment = Alignment.Center) { Text(if (status == "Concluído") "✓" else "◷", color = if (status == "Concluído") Color(0xFF10A36C) else Color(0xFF2085CF), fontSize = 17.sp, fontWeight = FontWeight.Bold) }; Spacer(Modifier.width(10.dp)); Column(modifier = Modifier.weight(1f)) { Text(hospital, color = Navy, fontSize = 11.sp, fontWeight = FontWeight.Bold); Text("UTI Adulto", color = Color(0xFF6A8199), fontSize = 9.sp); Text("24/10 • Entrada: 18:52 | Saída: —", color = Color(0xFF8EA1B5), fontSize = 8.sp); Text(if (status == "Concluído") "Entrada: 06:55 • Saída: 19:08 (12h 13m)" else "✓ Check-in via GPS validado", color = Color(0xFF0C9D68), fontSize = 8.sp) }; Text(status, color = if (status == "Concluído") Color(0xFF0C9D68) else Color(0xFF2386CF), fontSize = 8.sp, fontWeight = FontWeight.Bold); Icon(Icons.Default.ChevronRight, null, tint = Color(0xFF7C92A8), modifier = Modifier.size(17.dp)) } }

@Composable
internal fun ProfileSection(title: String, entries: List<Pair<String, String>>, onEdit: () -> Unit) {
    Row(verticalAlignment = Alignment.CenterVertically) {
        Text(title, color = DeepTeal, fontSize = 11.sp, fontWeight = FontWeight.Bold)
        Spacer(Modifier.weight(1f))
        Text("Editar ✎", color = DeepTeal, fontSize = 10.sp, fontWeight = FontWeight.Bold, modifier = Modifier.clickable(onClick = onEdit))
    }
    Spacer(Modifier.height(4.dp))
    Column(modifier = Modifier.fillMaxWidth().clip(RoundedCornerShape(8.dp)).border(1.dp, Color(0xFFE0E5E5), RoundedCornerShape(8.dp))) {
        entries.forEachIndexed { index, (label, value) ->
            Row(modifier = Modifier.fillMaxWidth().height(28.dp).clickable { }.padding(horizontal = 10.dp), verticalAlignment = Alignment.CenterVertically) {
                Text(label, color = Color(0xFF2D3137), fontSize = 9.sp, modifier = Modifier.weight(1f))
                Text(value, color = Color(0xFF2D3137), fontSize = 9.sp)
                Icon(Icons.Default.ChevronRight, null, tint = Navy, modifier = Modifier.size(15.dp))
            }
            if (index != entries.lastIndex) HorizontalDivider(color = Color(0xFFE7EAEB))
        }
    }
}

@Composable
internal fun ProfileEditorCard(title: String, fields: List<Pair<String, String>>, onCancel: () -> Unit, saving: Boolean = false, onSave: (List<String>) -> Unit) {
    val values = remember(fields) { mutableStateListOf(*fields.map { it.second }.toTypedArray()) }
    Column(
        modifier = Modifier.fillMaxWidth().padding(top = 8.dp).clip(RoundedCornerShape(10.dp)).background(Color(0xFFEAF7FA)).border(1.dp, Color(0xFFCBE7EB), RoundedCornerShape(10.dp)).padding(12.dp),
    ) {
        Text(title, color = Navy, fontSize = 13.sp, fontWeight = FontWeight.Bold)
        Spacer(Modifier.height(8.dp))
        fields.forEachIndexed { index, (label, _) ->
            OutlinedTextField(
                value = values[index],
                onValueChange = { values[index] = it },
                label = { Text(label, fontSize = 11.sp) },
                singleLine = true,
                textStyle = androidx.compose.ui.text.TextStyle(fontSize = 12.sp, color = Navy),
                modifier = Modifier.fillMaxWidth().height(53.dp),
                colors = OutlinedTextFieldDefaults.colors(focusedBorderColor = DeepTeal, unfocusedBorderColor = Color(0xFF93C8D1), focusedLabelColor = DeepTeal),
            )
            Spacer(Modifier.height(7.dp))
        }
        Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
            Text("Cancelar", color = Muted, fontSize = 11.sp, fontWeight = FontWeight.Bold, modifier = Modifier.clickable(enabled = !saving, onClick = onCancel).padding(10.dp))
            Spacer(Modifier.width(7.dp))
            Text(if (saving) "Salvando…" else "Salvar alterações", color = Color.White, fontSize = 11.sp, fontWeight = FontWeight.Bold, modifier = Modifier.clip(RoundedCornerShape(7.dp)).background(if (saving) Muted else DeepTeal).clickable(enabled = !saving) { onSave(values.toList()) }.padding(horizontal = 13.dp, vertical = 10.dp))
        }
    }
}

@Composable
private fun SettingsScreen(perfil: PerfilUsuario, onTabSelected: (String) -> Unit, onLogout: () -> Unit, onAbrirPerfil: () -> Unit = {}, onAbrirSeguranca: () -> Unit = {}) {
    var notificationsOpen by remember { mutableStateOf(false) }
    val primeiroNome = perfil.nome.trim().substringBefore(" ").ifBlank { "" }

    Surface(modifier = Modifier.fillMaxSize(), color = Color.White) {
        Box(modifier = Modifier.fillMaxSize()) {
            Column(
                modifier = Modifier.fillMaxSize().statusBarsPadding().navigationBarsPadding(),
            ) {
                Row(
                    modifier = Modifier.fillMaxWidth().height(52.dp).padding(horizontal = 20.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text("Configurações", color = Navy, fontSize = 16.sp, fontWeight = FontWeight.Bold)
                    Spacer(Modifier.weight(1f))
                    Box(
                        modifier = Modifier.size(40.dp).clickable { notificationsOpen = !notificationsOpen },
                        contentAlignment = Alignment.Center,
                    ) {
                        Icon(Icons.Default.NotificationsNone, "Notificações", tint = Navy, modifier = Modifier.size(24.dp))
                    }
                }

                Column(
                    modifier = Modifier.weight(1f).verticalScroll(rememberScrollState()).padding(horizontal = 16.dp),
                ) {
                    SettingsProfileCard(primeiroNome, perfil.crm, perfil.ufCrm)
                    Spacer(Modifier.height(10.dp))
                    SettingsCard {
                        Column(Modifier.padding(12.dp)) {
                            InfoRow("Nome", perfil.nome)
                            InfoRow("E-mail", perfil.email)
                            InfoRow("Perfil", perfil.tipoDescricao)
                            InfoRow("Conta", perfil.statusDescricao)
                            if (perfil.statusValidacao != null) InfoRow("Validação", perfil.validacaoDescricao)
                            if (perfil.statusValidacao == "REJEITADO" && !perfil.motivoRejeicao.isNullOrBlank()) InfoRow("Motivo", perfil.motivoRejeicao)
                        }
                    }
                    Spacer(Modifier.height(17.dp))
                    MainSettingsSectionTitle("Conta e segurança")
                    Spacer(Modifier.height(7.dp))
                    SettingsCard {
                        SettingsNavigationRow(Icons.Default.PersonOutline, "Dados pessoais", "Atualize suas informações.", Color(0xFFE0F4FF), Color(0xFF1683BF), onClick = onAbrirPerfil)
                        HorizontalDivider(color = Color(0xFFE7EAEB))
                        SettingsNavigationRow(Icons.Default.Lock, "Segurança e privacidade", "Senha, sessão e privacidade.", Color(0xFFE0F8EF), Color(0xFF0C9B72), onClick = onAbrirSeguranca)
                    }
                    Spacer(Modifier.height(15.dp))
                    MainSettingsSectionTitle("Preferências do aplicativo")
                    Spacer(Modifier.height(7.dp))
                    SettingsCard {
                        Text("Preferências de notificações indisponíveis no momento.", color = Muted, fontSize = 12.sp, modifier = Modifier.padding(12.dp))
                    }
                    Spacer(Modifier.height(19.dp))
                    SettingsCard { SettingsNavigationRow(Icons.Default.Logout, "Sair da conta", "", Color(0xFFFFE6E8), Color(0xFFFF4A53), showDescription = false, onClick = onLogout) }
                    Spacer(Modifier.height(20.dp))
                }
                HomeBottomNavigation("Configurações", onSelected = onTabSelected)
            }

            AnimatedVisibility(
                visible = notificationsOpen,
                modifier = Modifier.align(Alignment.TopEnd).statusBarsPadding().padding(top = 46.dp, end = 16.dp),
                enter = expandIn(expandFrom = Alignment.TopEnd) + fadeIn(),
                exit = shrinkOut(shrinkTowards = Alignment.TopEnd) + fadeOut(),
            ) { NotificationsPanel(onClose = { notificationsOpen = false }) }
        }
    }
}

@Composable
private fun SettingsProfileCard(name: String, crm: String?, uf: String?) {
    SettingsCard {
        Row(modifier = Modifier.padding(10.dp), verticalAlignment = Alignment.CenterVertically) {
            Box(
                modifier = Modifier.size(52.dp).clip(androidx.compose.foundation.shape.CircleShape).background(Color(0xFFD9F3FC)),
                contentAlignment = Alignment.Center,
            ) { Text(name.take(2).uppercase(), color = DeepTeal, fontWeight = FontWeight.Bold, fontSize = 16.sp) }
            Spacer(Modifier.width(13.dp))
            Column {
                Text(name, color = Navy, fontSize = 14.sp, fontWeight = FontWeight.Bold)
                Text("CRM ${crm.orEmpty()}-${uf.orEmpty()}", color = Muted, fontSize = 11.sp)

            }
        }
    }
}

@Composable
private fun MainSettingsSectionTitle(text: String) = Text(text, color = Navy, fontSize = 13.sp, fontWeight = FontWeight.Bold)

@Composable
private fun SettingsCard(content: @Composable ColumnScope.() -> Unit) {
    Column(
        modifier = Modifier.fillMaxWidth().clip(RoundedCornerShape(10.dp)).border(1.dp, Color(0xFFE0E5E5), RoundedCornerShape(10.dp)).background(Color.White),
        content = content,
    )
}

@Composable
private fun SettingsNavigationRow(icon: androidx.compose.ui.graphics.vector.ImageVector, title: String, description: String, background: Color, tint: Color, showDescription: Boolean = true, onClick: () -> Unit = {}) {
    Row(modifier = Modifier.fillMaxWidth().clickable(onClick = onClick).padding(9.dp), verticalAlignment = Alignment.CenterVertically) {
        SettingsIcon(icon, background, tint)
        Spacer(Modifier.width(10.dp))
        Column(modifier = Modifier.weight(1f)) {
            Text(title, color = if (showDescription) Navy else tint, fontSize = 11.sp, fontWeight = FontWeight.Bold)
            if (showDescription) Text(description, color = Navy, fontSize = 8.sp, lineHeight = 10.sp)
        }
        Icon(Icons.Default.ChevronRight, null, tint = Navy, modifier = Modifier.size(18.dp))
    }
}

@Composable
private fun SettingsIcon(icon: androidx.compose.ui.graphics.vector.ImageVector, background: Color, tint: Color) {
    Box(modifier = Modifier.size(30.dp).clip(RoundedCornerShape(7.dp)).background(background), contentAlignment = Alignment.Center) {
        Icon(icon, null, tint = tint, modifier = Modifier.size(19.dp))
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

@Preview(showBackground = true, backgroundColor = 0xFFF9FBFD, widthDp = 393, heightDp = 852)
@Composable
private fun InstitutionHomeScreenPreview() {
    MaterialTheme {
        InstitutionApp(
            perfil = PerfilUsuario(
                id = "preview-gestor",
                nome = "Gestor Seed",
                email = "gestor@alocca.com",
                tipo = "GESTOR",
                status = "ATIVO",
                crm = null,
                ufCrm = null,
                statusValidacao = null,
                motivoRejeicao = null,
            ),
            onLogout = {},
        )
    }
}

@Composable
internal fun HomeHeader(onNotification: () -> Unit, onLogout: () -> Unit) {
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

        }
    }
}

@Composable
internal fun NotificationsPanel(onClose: () -> Unit) {
    Surface(
        modifier = Modifier.width(300.dp),
        shape = RoundedCornerShape(16.dp),
        color = Color.White,
        shadowElevation = 10.dp,
        border = androidx.compose.foundation.BorderStroke(1.dp, Color(0xFFE0E5E5)),
    ) {
        Column(modifier = Modifier.padding(18.dp)) {
            Text("Notificações", color = Navy, fontSize = 17.sp, fontWeight = FontWeight.Bold)
            Spacer(Modifier.height(15.dp))
            Text("Notificações ainda não disponíveis.", color = Muted, fontSize = 12.sp)
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
internal fun SummaryItem(icon: androidx.compose.ui.graphics.vector.ImageVector, color: Color, value: String, label: String) {
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
internal fun SectionTitle(title: String, action: String, onAction: () -> Unit) {
    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
        Text(title, color = Navy, fontSize = 14.sp, fontWeight = FontWeight.Bold)
        Spacer(Modifier.weight(1f))
        Text(action, color = Cyan, fontSize = 13.sp, fontWeight = FontWeight.Bold, modifier = Modifier.clickable(onClick = onAction))
    }
}

@Composable
internal fun DetailLine(icon: androidx.compose.ui.graphics.vector.ImageVector, label: String, value: String, valueColor: Color = Navy) {
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
internal fun HomeBottomNavigation(active: String, onSelected: (String) -> Unit) {
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
internal fun InfoRow(label: String, value: String) {
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
    onEsqueciSenha: () -> Unit,
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
        Modifier.fillMaxWidth().wrapContentWidth(Alignment.End).padding(top = 8.dp).clickable(onClick = onEsqueciSenha),
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

// UC04: a resposta e sempre a mesma (MSG-05), exista o e-mail ou nao,
// pra ninguem descobrir quais e-mails tem conta.
// mockado: o back de recuperar senha ainda nao existe. quando existir,
// chamar POST auth/recuperar-senha no lugar do "enviado = true"
@Composable
private fun EsqueciSenhaForm(onLogin: () -> Unit) {
    var email by remember { mutableStateOf("") }
    var erro by remember { mutableStateOf("") }
    var enviado by remember { mutableStateOf(false) }

    AuthField("E-mail", email, { email = it; enviado = false }, "Seu@email.com", Icons.Default.Email, KeyboardType.Email)
    // mensagem colada na caixa do e-mail e com respiro antes do botao
    Spacer(Modifier.height(4.dp))
    if (erro.isNotBlank()) FeedbackText(erro, false)
    else if (enviado) FeedbackText("Se o e-mail constar em nossa base, um link de redefinição será enviado.", true)
    Spacer(Modifier.height(16.dp))
    PrimaryButton("Enviar link") {
        // mesma validacao de e-mail do login
        erro = if (!email.trim().matches(Regex("^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$"))) "Informe um e-mail válido." else ""
        enviado = erro.isEmpty()
    }
    Row(Modifier.fillMaxWidth().padding(top = 13.dp), horizontalArrangement = Arrangement.Center) {
        Text("Lembrou a senha? ", color = Muted, fontSize = 13.sp)
        Text("Voltar para o login", Modifier.clickable(onClick = onLogin), color = Border, fontWeight = FontWeight.Bold, fontSize = 13.sp)
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
        senha.any { it in 'a'..'z' } &&
        senha.any { it in 'A'..'Z' } &&
        senha.any { it in '0'..'9' }

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
