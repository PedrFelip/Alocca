package br.com.alocca.plantoes

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat

/**
 * Apresentação nativa: canal do sistema e notificação na bandeja/tela de
 * bloqueio, com o tap que reabre o app no plantão correspondente. Publicada
 * pelo serviço de sincronização (worker periódico/abertura do app) a partir
 * de itens não lidos do inbox autenticado. Não fala HTTP nem decide estado
 * da sessão — quem chama passa os dados prontos.
 */
internal object NotificadorLocal {
    const val CANAL_ID = "alocca_atualizacoes"
    // Conteúdo sensível só aparece no inbox autenticado; a bandeja é genérica.
    const val TEXTO_GENERICO = "Toque para ver no aplicativo."
    const val EXTRA_PLANTAO_ID = "alocca_extra_plantao_id"

    /** Idempotente: chamar no onCreate da activity e do worker. */
    fun criarCanal(context: Context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val canal = NotificationChannel(
            CANAL_ID,
            "Notificações de plantões",
            NotificationManager.IMPORTANCE_DEFAULT, // aparece na bandeja e na tela de bloqueio
        ).apply { description = "Alertas de alocação, presença e financeiro dos seus plantões." }
        context.getSystemService(NotificationManager::class.java).createNotificationChannel(canal)
    }

    /**
     * Publica na bandeja com o id estável derivado do id remoto: como a entrega
     * é at-least-once, a mesma notificação substitui a cópia em vez de duplicar.
     */
    fun publicar(context: Context, idRemoto: String, titulo: String, texto: String, plantaoId: String?): Boolean {
        if (semPermissao(context) || !NotificationManagerCompat.from(context).areNotificationsEnabled()) return false
        val intent = Intent(context, MainActivity::class.java).apply {
            // Deep link seguro: extra interno, validado por DeepLink.validar
            // na MainActivity antes de navegar.
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
            putExtra(EXTRA_PLANTAO_ID, DeepLink.validar(plantaoId))
        }
        val tap = PendingIntent.getActivity(
            context,
            idNotificacao(idRemoto),
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        val notificacao = NotificationCompat.Builder(context, CANAL_ID)
            .setSmallIcon(R.drawable.ic_notificacao)
            .setContentTitle(titulo)
            .setContentText(texto)
            .setStyle(NotificationCompat.BigTextStyle().bigText(texto))
            .setAutoCancel(true)
            .setVisibility(NotificationCompat.VISIBILITY_PRIVATE)
            .setOnlyAlertOnce(true)
            .setContentIntent(tap)
            .build()
        return runCatching {
            NotificationManagerCompat.from(context).notify(idNotificacao(idRemoto), notificacao)
            true
        }.getOrDefault(false)
    }

    /** Logout / troca de conta: nada da conta anterior fica na bandeja. */
    fun limpar(context: Context) {
        NotificationManagerCompat.from(context).cancelAll()
    }

    /** Id estável: o mesmo id remoto sempre vira o mesmo id de sistema. */
    internal fun idNotificacao(idRemoto: String): Int =
        (idRemoto.ifBlank { "alocca" }).hashCode()

    /** Rótulo humano a partir do `tipo` do contrato (sem inventar conteúdo). */
    internal fun tituloDoTipo(tipo: String): String {
        val limpo = tipo.replace('_', ' ').replace('-', ' ').trim()
        if (limpo.isEmpty()) return "Alocca"
        return limpo.replaceFirstChar { it.uppercase() }
    }

    private fun semPermissao(context: Context): Boolean =
        Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
            ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) !=
            PackageManager.PERMISSION_GRANTED
}
