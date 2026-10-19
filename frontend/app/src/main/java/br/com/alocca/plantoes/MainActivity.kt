package br.com.alocca.plantoes

import android.os.Bundle
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

private val Navy = Color(0xFF063957)
private val DeepTeal = Color(0xFF07566A)
private val Cyan = Color(0xFF09A9CE)
private val Muted = Color(0xFF657775)
private val CanvasColor = Color(0xFFF3F9F8)
private val Border = Color(0xFF48A8BC)

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

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

    Surface(Modifier.fillMaxSize(), color = CanvasColor) {
        Box(Modifier.fillMaxSize()) {
            DecorativeCorners()

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
                    LoginForm(onRegister = { screen = Screen.Register })
                } else {
                    Spacer(Modifier.height(10.dp))
                    Text("Criar sua conta", color = Navy, fontSize = 23.sp, fontWeight = FontWeight.Medium)
                    Spacer(Modifier.height(4.dp))
                    Text("Preencha os dados abaixo para começar.", color = Muted, fontSize = 13.sp)
                    Spacer(Modifier.height(18.dp))
                    RegisterForm(onLogin = { screen = Screen.Login })
                }

                Spacer(Modifier.height(18.dp))
                PrivacyCard()
                Spacer(Modifier.height(28.dp))
            }
        }
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
private fun LoginForm(onRegister: () -> Unit) {
    var email by remember { mutableStateOf("") }
    var password by remember { mutableStateOf("") }
    var visible by remember { mutableStateOf(false) }

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
    PrimaryButton("Entrar")
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
private fun RegisterForm(onLogin: () -> Unit) {
    var email by remember { mutableStateOf("") }
    var cpf by remember { mutableStateOf("") }
    var rm by remember { mutableStateOf("") }
    var password by remember { mutableStateOf("") }
    var confirm by remember { mutableStateOf("") }
    var visible by remember { mutableStateOf(false) }

    AuthField("E-mail", email, { email = it }, "Seu@email.com", Icons.Default.Email, KeyboardType.Email)
    Spacer(Modifier.height(16.dp))
    AuthField("CPF", cpf, { cpf = it }, "000.000.000-00", Icons.Default.PersonOutline, KeyboardType.Number)
    Spacer(Modifier.height(16.dp))
    AuthField("RM", rm, { rm = it }, "000000-DF", Icons.Default.PersonOutline, KeyboardType.Text)
    Spacer(Modifier.height(16.dp))
    AuthField(
        "Senha", password, { password = it }, "Crie uma senha segura", Icons.Default.Lock,
        KeyboardType.Password, password = true, visible = visible, onToggle = { visible = !visible }
    )
    Text(
        "Mínimo de 8 caracteres com letras, números e símbolos",
        color = Color(0xFFA9B5B4), fontSize = 10.sp, fontWeight = FontWeight.SemiBold,
        modifier = Modifier.fillMaxWidth().padding(start = 3.dp, top = 3.dp)
    )
    Spacer(Modifier.height(8.dp))
    AuthField(
        "Confirme sua senha", confirm, { confirm = it }, "Confirme sua senha", Icons.Default.Lock,
        KeyboardType.Password, password = true, visible = visible, onToggle = { visible = !visible }
    )
    Spacer(Modifier.height(14.dp))
    PrimaryButton("Cadastrar")
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
private fun PrimaryButton(text: String) {
    Button(
        onClick = { },
        modifier = Modifier.fillMaxWidth().height(48.dp),
        shape = RoundedCornerShape(7.dp),
        colors = ButtonDefaults.buttonColors(containerColor = DeepTeal),
        elevation = ButtonDefaults.buttonElevation(defaultElevation = 3.dp)
    ) {
        Text(text, color = Color.White, fontSize = 13.sp, fontWeight = FontWeight.Bold)
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