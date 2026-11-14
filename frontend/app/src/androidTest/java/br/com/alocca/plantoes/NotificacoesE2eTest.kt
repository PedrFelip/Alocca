package br.com.alocca.plantoes

import android.app.NotificationManager
import android.content.Context
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.uiautomator.By
import androidx.test.uiautomator.UiDevice
import androidx.test.uiautomator.Until
import androidx.work.ListenableWorker
import androidx.work.testing.TestListenableWorkerBuilder
import kotlinx.coroutines.runBlocking
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith

/** Requer fixture Docker test/support/preparar-notificacoes-android.ts + API3309. */
@RunWith(AndroidJUnit4::class)
class NotificacoesE2eTest {
    @Test
    fun apiRealWorkerNotificacaoDedupPreferenciasRefreshLogout() = runBlocking {
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        val context = instrumentation.targetContext
        instrumentation.uiAutomation.executeShellCommand("pm grant ${context.packageName} android.permission.POST_NOTIFICATIONS")
            .use { android.os.ParcelFileDescriptor.AutoCloseInputStream(it).readBytes() }
        TokenStore.clear(context)
        NotificacoesAgenda.cancelar(context)
        context.deleteDatabase("notificacoes_publicadas.db")
        NotificadorLocal.criarCanal(context)
        val entrada = AuthApi.post("auth/login", JSONObject()
            .put("email", "qa.notifications@example.test").put("senha", "Senha-Teste-123"))
        assertTrue("Login API real: ${entrada.status}", entrada.successful)
        var token = entrada.body!!.getString("access_token")
        TokenStore.salvarSessao(context, token, entrada.body!!.getString("refresh_token"))
        val conta = Sessao.usuarioIdDoToken(token)!!
        val lista = NotificacoesApi.listar(token, somenteNaoLidas = true)
        assertTrue(lista is Resposta.Ok)
        val item = (lista as Resposta.Ok).dados.itens.first()
        val manager = context.getSystemService(NotificationManager::class.java)
        try {
            assertTrue(NotificacoesApi.salvarPreferencias(token, PreferenciasNotificacao(false, true)) is Resposta.Ok)
            assertEquals(ListenableWorker.Result.success(), TestListenableWorkerBuilder<NotificacoesWorker>(context).build().doWork())
            assertEquals(0, manager.activeNotifications.size)
            assertTrue(NotificacoesApi.salvarPreferencias(token, PreferenciasNotificacao(true, true)) is Resposta.Ok)
            assertEquals(ListenableWorker.Result.success(), TestListenableWorkerBuilder<NotificacoesWorker>(context).build().doWork())
            assertTrue(manager.activeNotifications.any { it.id == NotificadorLocal.idNotificacao(item.id) })
            PublicacoesNotificacao(context).use { assertTrue(it.contem(conta, item.id)) }
            val detalhe = NotificacoesApi.plantao(token, item.plantaoId!!) as Resposta.Ok
            assertEquals(item.plantaoId, detalhe.dados.getString("id"))
            manager.activeNotifications.first { it.id == NotificadorLocal.idNotificacao(item.id) }.notification.contentIntent.send()
            assertTrue("Toque abre o plantão exato", UiDevice.getInstance(instrumentation)
                .wait(Until.hasObject(By.text("Plantão QA notificações")), 8000))
            val depois = NotificacoesApi.listar(token, somenteNaoLidas = true) as Resposta.Ok
            assertTrue(depois.dados.itens.any { it.id == item.id && it.naoLida })
            // Remover da bandeja e repetir prova deduplicação persistente, não só notify(id).
            manager.cancelAll()
            assertTrue(NotificacoesSincronizador.sincronizar(context))
            assertEquals(0, manager.activeNotifications.size)
            // Refresh real no servidor, rotação do par no Keystore.
            assertTrue(Sessao.renovarAposFalha(context, token))
            val novo = TokenStore.read(context)!!
            assertNotEquals(token, novo)
            assertEquals(Sessao.sidDoToken(token), Sessao.sidDoToken(novo))
            token = novo
            assertTrue(NotificacoesSincronizador.sincronizar(context))
            assertEquals(0, manager.activeNotifications.size)
            assertTrue(NotificacoesApi.marcarLida(token, item.id) is Resposta.Ok)
            assertTrue(NotificacoesApi.marcarLida(token, item.id) is Resposta.Ok)
            assertFalse((NotificacoesApi.listar(token, somenteNaoLidas = true) as Resposta.Ok).dados.itens.any { it.id == item.id })
            // Simula expiração local do access, mantendo refresh real: logout deve
            // renovar antes de revogar, sem deixar a sessão remota renovável.
            val refreshAntesSaida = TokenStore.lerRefresh(context)!!
            val partes = token.split('.').toMutableList()
            val payload = Sessao.claimsDoJwt(token)!!.put("exp", 1)
            partes[1] = android.util.Base64.encodeToString(payload.toString().toByteArray(), android.util.Base64.URL_SAFE or android.util.Base64.NO_WRAP or android.util.Base64.NO_PADDING)
            TokenStore.salvarSessao(context, partes.joinToString("."), refreshAntesSaida)
            val saida = Sessao.encerrar(context)
            assertTrue(saida.local); assertTrue(saida.remoto)
            assertFalse(AuthApi.refresh(refreshAntesSaida).successful)
            assertEquals(401, (NotificacoesApi.listar(token) as Resposta.Falha).status)
            assertTrue(NotificacoesSincronizador.sincronizar(context))
            assertEquals(0, manager.activeNotifications.size)
        } finally {
            AuthApi.logout(token)
            TokenStore.clear(context)
            NotificacoesAgenda.cancelar(context)
        }
    }
}
