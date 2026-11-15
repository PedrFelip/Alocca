package br.com.alocca.plantoes

import android.os.Handler
import android.os.Looper
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.AccountBalanceWallet
import androidx.compose.material.icons.filled.ArrowBack
import androidx.compose.material.icons.filled.CalendarMonth
import androidx.compose.material.icons.filled.ChevronRight
import androidx.compose.material.icons.filled.EventNote
import androidx.compose.material.icons.filled.Info
import androidx.compose.material.icons.filled.PersonAdd
import androidx.compose.material.icons.filled.MedicalServices
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import org.json.JSONObject
import java.text.SimpleDateFormat
import java.util.Calendar
import java.util.Locale

// Paleta da tela: usa os tons que o app já tem (Navy, DeepTeal, Muted, azul das abas e
// do menu inferior, chip azul-claro da lista de plantões e o fundo canvas).
private val PlantaoCanvas = Color(0xFFF3F9F8)
private val PlantaoAcao = Color(0xFF1475D1)
private val PlantaoChip = Color(0xFFE1F4FB)
private val PlantaoBorda = Color(0xFFC9DAE3)
private val PlantaoErro = Color(0xFFB42318)
private val PlantaoErroFundo = Color(0xFFFDECEA)
private val PlantaoSucesso = Color(0xFF0B8A5D)
private val PlantaoSucessoFundo = Color(0xFFE6F6EF)

internal val CampoPlantaoShape = RoundedCornerShape(12.dp)

/** Cores dos campos do formulário de plantão (rótulo flutuante, como no login). */
@Composable
internal fun campoPlantaoColors() = OutlinedTextFieldDefaults.colors(
    focusedTextColor = Navy,
    unfocusedTextColor = Navy,
    disabledTextColor = Muted,
    focusedBorderColor = PlantaoAcao,
    unfocusedBorderColor = PlantaoBorda,
    disabledBorderColor = Color(0xFFE3ECF1),
    focusedLabelColor = PlantaoAcao,
    unfocusedLabelColor = Muted,
    disabledLabelColor = Muted,
    focusedPlaceholderColor = Muted,
    unfocusedPlaceholderColor = Muted,
    disabledPlaceholderColor = Muted,
    focusedSupportingTextColor = Muted,
    unfocusedSupportingTextColor = Muted,
    disabledSupportingTextColor = Muted,
    cursorColor = PlantaoAcao,
    focusedContainerColor = Color.White,
    unfocusedContainerColor = Color.White,
    disabledContainerColor = Color(0xFFF3F6F8),
    focusedTrailingIconColor = DeepTeal,
    unfocusedTrailingIconColor = DeepTeal,
    disabledTrailingIconColor = Muted,
)

internal val CampoPlantaoTexto = TextStyle(fontSize = 16.sp, color = Navy)

@Composable
internal fun PublishShiftScreen(
    token: String?,
    onBack: () -> Unit,
    onPublished: () -> Unit,
    onNavigate: (InstitutionScreen) -> Unit,
) {
    val context = LocalContext.current
    var specialty by remember { mutableStateOf("") }
    var date by remember { mutableStateOf("") }
    var hours by remember { mutableStateOf("") }
    var endTime by remember { mutableStateOf("") }
    var location by remember { mutableStateOf("") }
    var value by remember { mutableStateOf("") }
    var vacancies by remember { mutableStateOf("") }
    var note by remember { mutableStateOf("") }
    var published by remember { mutableStateOf(false) }
    var successMessage by remember { mutableStateOf("") }
    var validationMessage by remember { mutableStateOf("") }
    var publishing by remember { mutableStateOf(false) }

    // Instituições vinculadas (UC10): base do campo de autoria institucional.
    var instituicoes by remember { mutableStateOf<List<InstituicaoVinculada>>(emptyList()) }
    var instituicaoSelecionada by remember { mutableStateOf<InstituicaoVinculada?>(null) }
    var instituicoesErro by remember { mutableStateOf("") }
    var instituicoesCarregando by remember { mutableStateOf(token != null) }
    var tentativasInstituicoes by remember { mutableStateOf(0) }
    var desmontada = remember { mutableStateOf(false) }
    DisposableEffect(Unit) {
        desmontada.value = false
        onDispose { desmontada.value = true }
    }

    LaunchedEffect(token, tentativasInstituicoes) {
        if (token == null) {
            instituicoesErro = PlantoesApi.MSG_SESSAO_EXPIRADA
            instituicoesCarregando = false
            return@LaunchedEffect
        }
        val rodada = tentativasInstituicoes
        instituicoesCarregando = true
        Thread {
            val resultado = runCatching { PlantoesApi.listarInstituicoesVinculadas(token) }
            Handler(Looper.getMainLooper()).post {
                if (desmontada.value || tentativasInstituicoes != rodada) return@post
                resultado.fold(
                    onSuccess = { lista ->
                        instituicoes = lista
                        instituicoesErro = ""
                        // Gestor com uma única instituição já sai selecionado.
                        if (instituicaoSelecionada == null && lista.size == 1) {
                            instituicaoSelecionada = lista.first()
                        }
                    },
                    onFailure = { falha ->
                        instituicoesErro = (falha as? ApiException)?.userMessage
                            ?: "Não foi possível carregar suas instituições."
                    },
                )
                instituicoesCarregando = false
            }
        }.start()
    }

    fun publicar() {
        val tokenAtual = token ?: run {
            validationMessage = PlantoesApi.MSG_SESSAO_EXPIRADA
            return
        }
        val faltando = instituicaoSelecionada == null ||
            listOf(specialty, date, hours, endTime, location, value, vacancies).any { it.isBlank() }
        if (faltando) {
            validationMessage = "Preencha todos os campos obrigatórios para publicar a vaga."
            return
        }
        val inicioIso = PlantoesApi.paraIso(date, hours)
        if (inicioIso == null) {
            validationMessage = "Data ou horário de início inválido (use dd/mm/aaaa e hh:mm)."
            return
        }
        // Plantão que vira o dia (ex.: 19:00 → 07:00) termina no dia seguinte.
        val calendarioFim = Calendar.getInstance().apply {
            time = SimpleDateFormat("dd/MM/yyyy", Locale.getDefault()).run {
                isLenient = false
                parse(date.trim()) ?: run {
                    validationMessage = "Data inválida (use dd/mm/aaaa)."
                    return
                }
            }
        }
        if (endTime.trim() <= hours.trim()) {
            calendarioFim.add(Calendar.DAY_OF_MONTH, 1)
        }
        val fimIso = PlantoesApi.paraIso(
            SimpleDateFormat("dd/MM/yyyy", Locale.getDefault()).format(calendarioFim.time),
            endTime,
        )
        if (fimIso == null) {
            validationMessage = "Horário de término inválido (use hh:mm)."
            return
        }
        // Aceita "1800", "1800,50" e "1.800,50" (formato brasileiro).
        val textoValor = value.trim().removePrefix("R$").trim()
        val valorNormalizado = if (textoValor.contains(',')) {
            textoValor.replace(".", "").replace(',', '.')
        } else {
            textoValor
        }
        val valorNumerico = valorNormalizado.toDoubleOrNull()
        // Mesmos limites do backend (numeric(10,2), mínimo 0.01). NaN/Infinity
        // passariam em comparações simples e o JSONObject.put lançaria na
        // thread principal — validar antes de montar o payload.
        when {
            valorNumerico == null || !valorNumerico.isFinite() || valorNumerico < 0.01 ->
                run {
                    validationMessage = "Informe um valor válido maior que zero (ex.: 1800 ou 1800,50)."
                    return
                }
            valorNumerico > 99_999_999.99 -> run {
                validationMessage = "O valor excede o máximo permitido (R$ 99.999.999,99)."
                return
            }
            Math.abs(valorNumerico * 100 - Math.round(valorNumerico * 100)) > 1e-6 -> run {
                validationMessage = "O valor pode ter no máximo 2 casas decimais."
                return
            }
        }
        val quantidade = vacancies.trim().toIntOrNull()
        if (quantidade == null || quantidade < 1 || quantidade > 10_000) {
            validationMessage = "A quantidade de vagas deve ser um número inteiro entre 1 e 10.000."
            return
        }
        if (specialty.trim().length > 100) {
            validationMessage = "A especialidade deve ter no máximo 100 caracteres."
            return
        }
        if (location.trim().length > 150) {
            validationMessage = "O local de atuação deve ter no máximo 150 caracteres."
            return
        }
        if (note.trim().length > 2000) {
            validationMessage = "As observações devem ter no máximo 2000 caracteres."
            return
        }
        val payload = JSONObject().apply {
            put("instituicao_id", instituicaoSelecionada!!.id)
            put("local_unidade", location.trim())
            put("especialidade", specialty.trim())
            put("data_inicio", inicioIso)
            put("data_fim", fimIso)
            put("valor", valorNumerico)
            put("quantidade_vagas", quantidade)
            if (note.isNotBlank()) put("descricao", note.trim())
        }
        validationMessage = ""
        publishing = true
        Thread {
            val resultado = runCatching { PlantoesApi.publicarPlantao(tokenAtual, payload) }
            Handler(Looper.getMainLooper()).post {
                publishing = false
                resultado.fold(
                    onSuccess = { mensagem ->
                        successMessage = mensagem.ifBlank { "Plantão publicado com sucesso!" }
                        published = true
                    },
                    onFailure = { falha ->
                        validationMessage = (falha as? ApiException)?.userMessage
                            ?: "Não foi possível publicar o plantão. Tente novamente."
                    },
                )
            }
        }.start()
    }

    Surface(modifier = Modifier.fillMaxSize(), color = PlantaoCanvas) {
        Column(modifier = Modifier.fillMaxSize().statusBarsPadding().navigationBarsPadding()) {
            Row(
                modifier = Modifier.fillMaxWidth().height(64.dp).padding(start = 8.dp, end = 16.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                IconButton(onClick = onBack, modifier = Modifier.size(48.dp)) {
                    Icon(Icons.Default.ArrowBack, contentDescription = "Voltar", tint = Navy)
                }
                Spacer(Modifier.width(4.dp))
                Text(
                    "Publicar plantão",
                    color = Navy,
                    fontSize = 22.sp,
                    fontWeight = FontWeight.Bold,
                    modifier = Modifier.semantics { heading() },
                )
            }
            Column(
                modifier = Modifier.weight(1f).verticalScroll(rememberScrollState()).padding(horizontal = 16.dp),
                verticalArrangement = Arrangement.spacedBy(14.dp),
            ) {
                Text(
                    "Preencha as informações abaixo para publicar um plantão na sua instituição.",
                    color = Muted,
                    fontSize = 14.sp,
                    lineHeight = 20.sp,
                    modifier = Modifier.padding(horizontal = 4.dp),
                )
                SecaoPlantao(Icons.Default.MedicalServices, "Vaga") {
                    InstitutionPicker(
                        value = instituicaoSelecionada?.nomeFantasia ?: instituicaoSelecionada?.nome.orEmpty(),
                        options = instituicoes,
                        loading = instituicoesCarregando,
                        onSelect = { instituicaoSelecionada = it },
                    )
                    CampoPlantaoTexto("Especialidade médica", specialty, { specialty = it }, "Digite a especialidade")
                }
                SecaoPlantao(Icons.Default.CalendarMonth, "Quando e onde") {
                    DateTimePickerField("Data do plantão", date, { date = it })
                    Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                        Box(Modifier.weight(1f)) { DateTimePickerField("Início", hours, { hours = it }, time = true) }
                        Box(Modifier.weight(1f)) { DateTimePickerField("Término", endTime, { endTime = it }, time = true) }
                    }
                    if (hours.isNotBlank() && endTime.isNotBlank() && endTime <= hours) {
                        Row(
                            modifier = Modifier.fillMaxWidth().clip(RoundedCornerShape(10.dp)).background(PlantaoChip).padding(horizontal = 12.dp, vertical = 10.dp),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            Icon(Icons.Default.Info, contentDescription = null, tint = DeepTeal, modifier = Modifier.size(18.dp))
                            Spacer(Modifier.width(8.dp))
                            Text(if (hours == endTime) "O plantão dura 24 horas e termina no dia seguinte." else "O plantão termina no dia seguinte.", color = Navy, fontSize = 13.sp)
                        }
                    }
                    CampoPlantaoTexto("Local de atuação", location, { location = it }, "Digite o nome ou endereço da unidade")
                }
                SecaoPlantao(Icons.Default.AccountBalanceWallet, "Condições") {
                    Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                        Box(Modifier.weight(1.3f)) { CampoPlantaoTexto("Valor do plantão", value, { value = it }, "R$ 0,00") }
                        Box(Modifier.weight(1f)) { CampoPlantaoTexto("Vagas", vacancies, { vacancies = it }, "Ex.: 10") }
                    }
                    OutlinedTextField(
                        value = note,
                        onValueChange = { note = it },
                        label = { Text("Observações (opcional)") },
                        placeholder = { Text("Informações adicionais sobre o plantão, como requisitos, tipo de atendimento, etc.", fontSize = 14.sp, lineHeight = 20.sp) },
                        textStyle = CampoPlantaoTexto,
                        modifier = Modifier.fillMaxWidth().heightIn(min = 112.dp),
                        shape = CampoPlantaoShape,
                        colors = campoPlantaoColors(),
                        minLines = 3,
                        maxLines = 5,
                    )
                }
                if (instituicoesErro.isNotBlank()) {
                    AvisoPlantao(instituicoesErro, PlantaoErro, PlantaoErroFundo)
                    OutlinedButton(
                        onClick = { tentativasInstituicoes += 1 },
                        modifier = Modifier.fillMaxWidth().height(48.dp),
                        shape = RoundedCornerShape(12.dp),
                        border = BorderStroke(1.dp, PlantaoAcao),
                        colors = ButtonDefaults.outlinedButtonColors(contentColor = PlantaoAcao),
                    ) { Text("Tentar novamente", fontWeight = FontWeight.Bold) }
                }
                if (validationMessage.isNotBlank()) {
                    AvisoPlantao(validationMessage, PlantaoErro, PlantaoErroFundo)
                }
                if (published) {
                    AvisoPlantao(successMessage, PlantaoSucesso, PlantaoSucessoFundo)
                }
                Button(
                    onClick = {
                        if (published) {
                            onPublished()
                        } else if (!publishing) {
                            publicar()
                        }
                    },
                    enabled = !publishing,
                    modifier = Modifier.fillMaxWidth().height(56.dp),
                    shape = RoundedCornerShape(14.dp),
                    colors = ButtonDefaults.buttonColors(
                        containerColor = PlantaoAcao,
                        contentColor = Color.White,
                        disabledContainerColor = PlantaoAcao.copy(alpha = 0.6f),
                        disabledContentColor = Color.White,
                    ),
                ) {
                    if (publishing) {
                        CircularProgressIndicator(color = Color.White, strokeWidth = 2.dp, modifier = Modifier.size(20.dp))
                    } else {
                        Icon(Icons.Default.EventNote, null, tint = Color.White, modifier = Modifier.size(20.dp))
                    }
                    Spacer(Modifier.width(10.dp))
                    Text(
                        when {
                            published -> "Ver plantões publicados"
                            publishing -> "Publicando..."
                            else -> "Publicar plantão"
                        },
                        fontSize = 16.sp,
                        fontWeight = FontWeight.Bold,
                    )
                }
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .heightIn(min = 64.dp)
                        .clip(RoundedCornerShape(16.dp))
                        .background(Color.White)
                        .border(1.dp, PlantaoBorda, RoundedCornerShape(16.dp))
                        .clickable(role = Role.Button) { onNavigate(InstitutionScreen.Doctors) }
                        .padding(horizontal = 16.dp, vertical = 12.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    IconeSecao(Icons.Default.PersonAdd)
                    Spacer(Modifier.width(12.dp))
                    Text("Convidar médicos", color = Navy, fontSize = 16.sp, fontWeight = FontWeight.Bold, modifier = Modifier.weight(1f))
                    Icon(Icons.Default.ChevronRight, contentDescription = null, tint = Muted)
                }
                Spacer(Modifier.height(8.dp))
            }
            ManagerBottomNavigation(InstitutionScreen.Shifts, onNavigate)
        }
    }
}

/** Cartão que agrupa campos relacionados; o ícone da seção substitui um ícone por campo. */
@Composable
private fun SecaoPlantao(icon: ImageVector, titulo: String, content: @Composable ColumnScope.() -> Unit) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(16.dp))
            .background(Color.White)
            .border(1.dp, PlantaoBorda, RoundedCornerShape(16.dp))
            .padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        Row(
            modifier = Modifier.semantics(mergeDescendants = true) { heading() },
            verticalAlignment = Alignment.CenterVertically,
        ) {
            IconeSecao(icon)
            Spacer(Modifier.width(12.dp))
            Text(titulo, color = Navy, fontSize = 16.sp, fontWeight = FontWeight.Bold)
        }
        content()
    }
}

@Composable
private fun IconeSecao(icon: ImageVector) {
    Box(
        modifier = Modifier.size(36.dp).clip(RoundedCornerShape(10.dp)).background(PlantaoChip),
        contentAlignment = Alignment.Center,
    ) { Icon(icon, contentDescription = null, tint = DeepTeal, modifier = Modifier.size(20.dp)) }
}

@Composable
private fun CampoPlantaoTexto(label: String, value: String, onChange: (String) -> Unit, placeholder: String) {
    OutlinedTextField(
        value = value,
        onValueChange = onChange,
        label = { Text(label, maxLines = 1) },
        placeholder = { Text(placeholder, fontSize = 15.sp, maxLines = 1) },
        singleLine = true,
        textStyle = CampoPlantaoTexto,
        modifier = Modifier.fillMaxWidth().heightIn(min = 56.dp),
        shape = CampoPlantaoShape,
        colors = campoPlantaoColors(),
    )
}

@Composable
private fun AvisoPlantao(texto: String, cor: Color, fundo: Color) {
    Text(
        texto,
        color = cor,
        fontSize = 14.sp,
        lineHeight = 20.sp,
        fontWeight = FontWeight.Medium,
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(12.dp))
            .background(fundo)
            .padding(horizontal = 14.dp, vertical = 12.dp)
            .semantics { liveRegion = LiveRegionMode.Polite },
    )
}
