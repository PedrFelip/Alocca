package br.com.alocca.plantoes

import android.os.Bundle
import android.os.Handler
import android.os.Looper
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.core.view.WindowCompat
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
import androidx.compose.material.icons.filled.PersonOutline
import androidx.compose.material.icons.filled.Visibility
import androidx.compose.material.icons.filled.VisibilityOff
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
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.graphics.drawscope.Fill
import org.json.JSONObject

private val Navy = Color(0xFF063957)
private val DeepTeal = Color(0xFF07566A)
private val Cyan = Color(0xFF09A9CE)
private val Muted = Color(0xFF657775)
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

private enum class Screen { Login, Register }

@Composable
private fun AuthApp() {
    var screen by remember { mutableStateOf(Screen.Login) }
    var loading by remember { mutableStateOf(false) }
    var feedback by remember { mutableStateOf("") }
    var feedbackSuccess by remember { mutableStateOf(false) }
    var perfil by remember { mutableStateOf<PerfilUsuario?>(null) }
    var restoring by remember { mutableStateOf(true) }
    val context = androidx.compose.ui.platform.LocalContext.current

    LaunchedEffect(Unit) {
        Thread {
            val token = TokenStore.read(context)
            if (token == null) {
                Handler(Looper.getMainLooper()).post { restoring = false }
            } else {
                val result = AuthApi.getProfile(token)
                val autenticado = if (result.successful) PerfilUsuario.fromJson(result.body) else null
                val sessionExpired = result.status == 401 || result.status == 403
                if (autenticado == null && (result.successful || sessionExpired)) {
                    TokenStore.clear(context)
                }
                Handler(Looper.getMainLooper()).post {
                    when {
                        autenticado != null -> perfil = autenticado
                        sessionExpired -> feedback = "Sua sessão expirou. Entre novamente."
                        else -> feedback = result.message.ifBlank {
                            "Não foi possível restaurar sua sessão. Entre novamente."
                        }
                    }
                    restoring = false
                }
            }
        }.start()
    }

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
        TokenStore.clear(context)
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
                            onSubmit = { nome, email, crm, uf, senha ->
                                val payload = JSONObject().put("nome", nome.trim()).put("email", email.trim())
                                    .put("senha", senha).put("crm", crm.trim()).put("uf_crm", uf.trim().uppercase())
                                submit("auth/register/medico", payload) {
                                    feedback = "Cadastro enviado. Você já pode entrar."
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
    Column(
        modifier = Modifier
            .fillMaxSize()
            .statusBarsPadding()
            .navigationBarsPadding()
            .verticalScroll(rememberScrollState())
            .padding(horizontal = 20.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Spacer(Modifier.height(36.dp))
        BrandLogo()
        Spacer(Modifier.height(26.dp))
        Text(
            text = "Olá, ${perfil.nome}",
            color = Navy,
            fontSize = 23.sp,
            fontWeight = FontWeight.Medium,
            textAlign = TextAlign.Center,
        )
        Spacer(Modifier.height(6.dp))
        Text(perfil.email, color = Muted, fontSize = 13.sp, textAlign = TextAlign.Center)
        Spacer(Modifier.height(24.dp))
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .clip(RoundedCornerShape(8.dp))
                .background(Color(0xFFD3E9EA))
                .padding(16.dp),
        ) {
            Text("Sessão ativa", color = Navy, fontSize = 15.sp, fontWeight = FontWeight.Bold)
            Spacer(Modifier.height(4.dp))
            Text(
                "Você está conectado ao Alocca com segurança.",
                color = Muted,
                fontSize = 12.sp,
                lineHeight = 16.sp,
            )
        }
        Spacer(Modifier.height(16.dp))
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .clip(RoundedCornerShape(8.dp))
                .background(Color.White)
                .border(1.dp, Color(0xFFD7E2E1), RoundedCornerShape(8.dp))
                .padding(16.dp),
        ) {
            Text("Sua conta", color = Navy, fontSize = 15.sp, fontWeight = FontWeight.Bold)
            Spacer(Modifier.height(10.dp))
            InfoRow("Nome", perfil.nome)
            InfoRow("E-mail", perfil.email)
            InfoRow("Perfil", perfil.tipoDescricao)
            InfoRow("Conta", perfil.statusDescricao)
            if (perfil.crm != null) {
                InfoRow("CRM", listOfNotNull(perfil.crm, perfil.ufCrm).joinToString(" / "))
            }
            if (perfil.statusValidacao != null) {
                InfoRow("Validação", perfil.validacaoDescricao)
            }
            if (perfil.statusValidacao == "REJEITADO" && !perfil.motivoRejeicao.isNullOrBlank()) {
                InfoRow("Motivo", perfil.motivoRejeicao)
            }
        }
        Spacer(Modifier.height(24.dp))
        Button(
            onClick = onLogout,
            modifier = Modifier.fillMaxWidth().height(48.dp),
            shape = RoundedCornerShape(7.dp),
            colors = ButtonDefaults.buttonColors(
                containerColor = Color(0xFFD3E9EA),
                contentColor = DeepTeal,
            ),
        ) {
            Text("Sair da conta", fontSize = 13.sp, fontWeight = FontWeight.Bold)
        }
        Spacer(Modifier.height(28.dp))
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

@Composable
private fun RegisterForm(
    onLogin: () -> Unit,
    loading: Boolean,
    feedback: String,
    feedbackSuccess: Boolean,
    onSubmit: (String, String, String, String, String) -> Unit
) {
    var name by remember { mutableStateOf("") }
    var email by remember { mutableStateOf("") }
    var crm by remember { mutableStateOf("") }
    var uf by remember { mutableStateOf("") }
    var password by remember { mutableStateOf("") }
    var confirm by remember { mutableStateOf("") }
    var visible by remember { mutableStateOf(false) }
    var formError by remember { mutableStateOf("") }

    AuthField("Nome completo", name, { name = it }, "Seu nome", Icons.Default.PersonOutline, KeyboardType.Text)
    Spacer(Modifier.height(16.dp))
    AuthField("E-mail", email, { email = it }, "Seu@email.com", Icons.Default.Email, KeyboardType.Email)
    Spacer(Modifier.height(16.dp))
    AuthField("CRM", crm, { crm = it }, "Apenas números", Icons.Default.PersonOutline, KeyboardType.Number)
    Spacer(Modifier.height(16.dp))
    AuthField("UF do CRM", uf, { uf = it.uppercase().take(2) }, "Ex.: SP", Icons.Default.PersonOutline, KeyboardType.Text)
    Spacer(Modifier.height(16.dp))
    AuthField(
        "Senha", password, { password = it }, "Crie uma senha segura", Icons.Default.Lock,
        KeyboardType.Password, password = true, visible = visible, onToggle = { visible = !visible }
    )
    Text(
        "Use de 8 a 128 caracteres.",
        color = Color(0xFFA9B5B4), fontSize = 10.sp, fontWeight = FontWeight.SemiBold,
        modifier = Modifier.fillMaxWidth().padding(start = 3.dp, top = 3.dp)
    )
    Spacer(Modifier.height(8.dp))
    AuthField(
        "Confirme sua senha", confirm, { confirm = it }, "Confirme sua senha", Icons.Default.Lock,
        KeyboardType.Password, password = true, visible = visible, onToggle = { visible = !visible }
    )
    Spacer(Modifier.height(14.dp))
    if (formError.isNotBlank()) FeedbackText(formError, false)
    else if (feedback.isNotBlank()) FeedbackText(feedback, feedbackSuccess)
    PrimaryButton("Cadastrar", loading) {
        formError = when {
            name.trim().length < 2 -> "Informe seu nome completo (mínimo 2 caracteres)."
            !email.trim().matches(Regex("^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$")) -> "Informe um e-mail válido."
            crm.isBlank() || !crm.matches(Regex("^\\d{1,20}$")) -> "O CRM deve conter apenas números."
            uf !in setOf("AC", "AL", "AP", "AM", "BA", "CE", "DF", "ES", "GO", "MA", "MT", "MS", "MG", "PA", "PB", "PR", "PE", "PI", "RJ", "RN", "RS", "RO", "RR", "SC", "SP", "SE", "TO") -> "Informe uma UF válida para o CRM."
            password.length < 8 -> "A senha deve ter pelo menos 8 caracteres."
            password.length > 128 -> "A senha deve ter no máximo 128 caracteres."
            password != confirm -> "As senhas não coincidem."
            else -> ""
        }
        if (formError.isEmpty()) onSubmit(name, email, crm, uf, password)
    }
    Row(Modifier.fillMaxWidth().padding(top = 13.dp), horizontalArrangement = Arrangement.Center) {
        Text("Já tem uma conta? ", color = Muted, fontSize = 13.sp)
        Text("Faça Login", Modifier.clickable(onClick = onLogin), color = Border, fontWeight = FontWeight.Bold, fontSize = 13.sp)
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
    onToggle: (() -> Unit)? = null
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
                    VisualTransformation.None
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
