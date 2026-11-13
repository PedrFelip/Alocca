package br.com.alocca.plantoes

import android.Manifest
import android.annotation.SuppressLint
import android.content.Context
import android.content.pm.PackageManager
import android.location.Location
import android.location.LocationManager
import android.os.Handler
import android.os.Looper
import androidx.core.content.ContextCompat
import androidx.core.location.LocationManagerCompat
import androidx.core.os.CancellationSignal
import java.text.SimpleDateFormat
import java.util.Calendar
import java.util.Date
import java.util.Locale
import java.util.TimeZone

private val brasil = Locale.forLanguageTag("pt-BR")

// o back manda em utc ("2026-11-12T20:55:42.258Z")
private fun lerData(iso: String): Date? {
    val formato = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US).apply {
        timeZone = TimeZone.getTimeZone("UTC")
    }
    return runCatching { formato.parse(iso) }.getOrNull()
}

// mostra no fuso do celular
private fun formatar(iso: String, padrao: String): String =
    lerData(iso)?.let { SimpleDateFormat(padrao, brasil).format(it) } ?: "--"

private fun ehHoje(iso: String): Boolean {
    val data = lerData(iso) ?: return false
    val hoje = Calendar.getInstance()
    val dia = Calendar.getInstance().apply { time = data }
    return hoje.get(Calendar.YEAR) == dia.get(Calendar.YEAR) &&
        hoje.get(Calendar.DAY_OF_YEAR) == dia.get(Calendar.DAY_OF_YEAR)
}

// "07:00 às 19:00"
internal fun horarioDoPlantao(p: PlantaoProximo): String =
    "${formatar(p.dataInicio, "HH:mm")} às ${formatar(p.dataFim, "HH:mm")}"

// "12/11/2026 (Hoje)"
internal fun dataDoPlantao(p: PlantaoProximo): String =
    formatar(p.dataInicio, "dd/MM/yyyy") + if (ehHoje(p.dataInicio)) " (Hoje)" else ""

// "Hoje, 12 de novembro • 07:00 às 19:00"
internal fun resumoDoPlantao(p: PlantaoProximo): String {
    val dia = formatar(p.dataInicio, "d 'de' MMMM")
    return (if (ehHoje(p.dataInicio)) "Hoje, $dia" else dia) + " • " + horarioDoPlantao(p)
}

// pega a posicao uma vez so, na hora do toque (RN19)
// sem permissao, gps desligado ou demorou demais: devolve null e o check-in vai sem localizacao
// a posicao nao e salva em lugar nenhum no celular, so vai no POST
@SuppressLint("MissingPermission")
internal fun pegarLocalizacao(context: Context, quandoTiver: (Location?) -> Unit) {
    val temPermissao = listOf(Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION)
        .any { ContextCompat.checkSelfPermission(context, it) == PackageManager.PERMISSION_GRANTED }
    val gps = context.getSystemService(Context.LOCATION_SERVICE) as? LocationManager
    val provedor = listOf(LocationManager.GPS_PROVIDER, LocationManager.NETWORK_PROVIDER)
        .firstOrNull { gps?.isProviderEnabled(it) == true }
    if (!temPermissao || gps == null || provedor == null) {
        quandoTiver(null)
        return
    }

    val cancelar = CancellationSignal()
    val handler = Handler(Looper.getMainLooper())
    var respondeu = false
    // espera no maximo 10s pelo gps
    handler.postDelayed({
        if (!respondeu) {
            respondeu = true
            cancelar.cancel()
            quandoTiver(null)
        }
    }, 10_000)
    LocationManagerCompat.getCurrentLocation(gps, provedor, cancelar, ContextCompat.getMainExecutor(context)) { local ->
        if (!respondeu) {
            respondeu = true
            handler.removeCallbacksAndMessages(null)
            quandoTiver(local)
        }
    }
}
