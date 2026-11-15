package br.com.alocca.plantoes

import android.app.DatePickerDialog
import android.app.TimePickerDialog
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.AccessTime
import androidx.compose.material.icons.filled.CalendarMonth
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.onClick
import androidx.compose.ui.semantics.role
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import java.text.SimpleDateFormat
import java.util.Calendar
import java.util.Locale

/** Uses local calendar dates throughout, avoiding UTC date shifts. */
@Composable
internal fun DateTimePickerField(
    label: String,
    value: String,
    onValueChange: (String) -> Unit,
    time: Boolean = false,
    // quando a tela ja tem um titulo em cima do campo, o rotulo dentro fica repetido
    mostrarRotulo: Boolean = true,
) {
    val context = LocalContext.current
    val format = if (time) "HH:mm" else "dd/MM/yyyy"
    val openPicker = {
        val calendar = Calendar.getInstance()
        val formatter = SimpleDateFormat(format, Locale.getDefault()).apply { isLenient = false }
        val parsed = runCatching { formatter.parse(value) }.getOrNull()
        if (parsed != null) calendar.time = parsed
        if (time) {
            TimePickerDialog(context, { _, hour, minute ->
                onValueChange(String.format(Locale.ROOT, "%02d:%02d", hour, minute))
            }, calendar.get(Calendar.HOUR_OF_DAY), calendar.get(Calendar.MINUTE), true).show()
        } else {
            val dialogo = DatePickerDialog(context, { _, year, month, day ->
                onValueChange(String.format(Locale.ROOT, "%02d/%02d/%04d", day, month + 1, year))
            }, calendar.get(Calendar.YEAR), calendar.get(Calendar.MONTH), calendar.get(Calendar.DAY_OF_MONTH))
            // nao deixa escolher dia que ja passou: plantao no passado nao recebe candidatura
            val hoje = Calendar.getInstance().apply {
                set(Calendar.HOUR_OF_DAY, 0)
                set(Calendar.MINUTE, 0)
                set(Calendar.SECOND, 0)
                set(Calendar.MILLISECOND, 0)
            }
            dialogo.datePicker.minDate = hoje.timeInMillis
            dialogo.show()
        }
        Unit
    }
    // Merge the label and value into one accessible, full-field button.
    Box(Modifier.clearAndSetSemantics {
        contentDescription = "$label, ${value.ifBlank { "Não selecionado" }}"
        role = Role.Button
        onClick(if (time) "Selecionar horário" else "Selecionar data") { openPicker(); true }
    }) {
        OutlinedTextField(
            value = value,
            onValueChange = {},
            readOnly = true,
            // maxLines = 1 pra palavra nao quebrar no meio quando o campo e estreito
            label = if (mostrarRotulo) {
                { Text(label, maxLines = 1, overflow = TextOverflow.Ellipsis) }
            } else null,
            placeholder = {
                val dica = when {
                    mostrarRotulo && time -> "hh:mm"
                    mostrarRotulo -> "dd/mm/aaaa"
                    time -> "Selecione o horário"
                    else -> "Selecione a data"
                }
                Text(dica, maxLines = 1, overflow = TextOverflow.Ellipsis)
            },
            trailingIcon = {
                Icon(if (time) Icons.Default.AccessTime else Icons.Default.CalendarMonth, contentDescription = null)
            },
            modifier = Modifier.fillMaxWidth().heightIn(min = 56.dp),
            singleLine = true,
        )
        Box(Modifier.matchParentSize().clickable(
            role = Role.Button,
            onClickLabel = if (time) "Selecionar horário" else "Selecionar data",
            onClick = openPicker,
        ))
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun InstitutionPicker(
    value: String,
    options: List<InstituicaoVinculada>,
    loading: Boolean,
    onSelect: (InstituicaoVinculada) -> Unit,
) {
    var expanded by remember { mutableStateOf(false) }
    val enabled = !loading && options.isNotEmpty()
    ExposedDropdownMenuBox(expanded = expanded && enabled, onExpandedChange = { if (enabled) expanded = it }) {
        OutlinedTextField(
            value = value,
            onValueChange = {},
            readOnly = true,
            enabled = enabled,
            placeholder = { Text(when {
                loading -> "Carregando instituições…"
                options.isEmpty() -> "Nenhuma instituição vinculada"
                else -> "Selecione a instituição"
            }) },
            trailingIcon = { ExposedDropdownMenuDefaults.TrailingIcon(expanded = expanded && enabled) },
            modifier = Modifier.menuAnchor(MenuAnchorType.PrimaryNotEditable, enabled = enabled).fillMaxWidth(),
            singleLine = true,
        )
        ExposedDropdownMenu(expanded = expanded && enabled, onDismissRequest = { expanded = false }) {
            options.forEach { institution ->
                DropdownMenuItem(text = { Text(institution.nomeFantasia ?: institution.nome) }, onClick = {
                    onSelect(institution)
                    expanded = false
                })
            }
        }
    }
}
