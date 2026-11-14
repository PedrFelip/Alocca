package br.com.alocca.plantoes

import android.content.Context
import androidx.work.BackoffPolicy
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.NetworkType
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import java.util.concurrent.TimeUnit
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/**
 * Worker periódico (WorkManager, mínimo de 15 min exigido pelo sistema) que
 * sincroniza o inbox e publica notificações locais. Roda com rede disponível;
 * o sistema decide o momento exato dentro da janela — o atraso do "flex" é
 * comportamento do WorkManager, não erro do app. Sem foreground service.
 */
class NotificacoesWorker(
    context: Context,
    params: WorkerParameters,
) : CoroutineWorker(context, params) {

    override suspend fun doWork(): Result = withContext(Dispatchers.IO) { when (runCatching {
        NotificacoesSincronizador.sincronizar(applicationContext)
    }.getOrDefault(false)) {
        true -> Result.success()
        // Falha de rede/401 final: tenta de novo com backoff; o periódico continua.
        false -> Result.retry()
    } }
}

/** Agendamento único por app: agendar no login/abertura, cancelar no logout. */
internal object NotificacoesAgenda {
    fun agendar(context: Context) {
        val pedido = PeriodicWorkRequestBuilder<NotificacoesWorker>(15, TimeUnit.MINUTES)
            .setConstraints(
                Constraints.Builder()
                    .setRequiredNetworkType(NetworkType.CONNECTED)
                    .build(),
            )
            .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 30, TimeUnit.SECONDS)
            .build()
        WorkManager.getInstance(context).enqueueUniquePeriodicWork(
            NotificacoesSincronizador.NOME_TRABALHO,
            ExistingPeriodicWorkPolicy.KEEP,
            pedido,
        )
    }

    /** Logout / troca de conta: para o trabalho e limpa a bandeja da conta. */
    fun cancelar(context: Context) {
        WorkManager.getInstance(context)
            .cancelUniqueWork(NotificacoesSincronizador.NOME_TRABALHO)
        NotificadorLocal.limpar(context)
    }
}
