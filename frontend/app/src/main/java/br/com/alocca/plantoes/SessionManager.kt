package br.com.alocca.plantoes

import android.content.Context
import org.json.JSONObject
import java.util.concurrent.Executors

/** Owns refresh rotation; the lock never prevents local logout. */
internal object SessionManager {
    @Volatile private var context: Context? = null
    private val rotation = SessionRotation()
    private val logoutExecutor = Executors.newSingleThreadExecutor()

    fun initialize(context: Context) { this.context = context.applicationContext }

    fun save(context: Context, body: JSONObject) {
        initialize(context)
        TokenStore.saveSession(context, sessionFrom(body))
    }

    fun logout(context: Context): Boolean {
        val session = synchronized(TokenStore) {
            val current = TokenStore.readSession(context)
            val cleared = TokenStore.clear(context)
            current to cleared
        }
        session.first?.let { old -> logoutExecutor.execute { AuthApi.revogar(old.refresh) } }
        return session.second
    }

    internal fun currentAccess(fallback: String): String = context?.let {
        TokenStore.readSession(it)?.access
    } ?: fallback

    internal data class RefreshResult(val access: String?, val status: Int)

    internal fun refresh(failedAccess: String): RefreshResult {
        val ctx = context ?: return RefreshResult(null, 401)
        if (TokenStore.readSession(ctx) == null) {
            TokenStore.clearIfMatches(ctx, failedAccess)
            return RefreshResult(null, 401)
        }
        return rotation.refresh(failedAccess, { TokenStore.readSession(ctx) }, { AuthApi.renovar(it) },
            { old, replacement -> TokenStore.replaceIfMatches(ctx, old, replacement) },
            { old -> TokenStore.clearIfMatches(ctx, old.access) }, { sessionFrom(it) })
    }

    private fun sessionFrom(body: JSONObject): TokenStore.Session {
        val access = body.getString("access_token")
        val refresh = body.getString("refresh_token")
        val accessSeconds = body.getLong("expires_in")
        val refreshSeconds = body.getLong("refresh_expires_in")
        require(access.isNotBlank() && refresh.isNotBlank() && accessSeconds > 0 && refreshSeconds > 0)
        val now = System.currentTimeMillis()
        fun expiry(seconds: Long): Long = Math.addExact(now, Math.multiplyExact(seconds, 1000L))
        return TokenStore.Session(access, refresh, expiry(accessSeconds), expiry(refreshSeconds))
    }
}

internal class SessionRotation {
    @Volatile private var generation = 0L
    private var lastAccess: String? = null
    private var lastResult: SessionManager.RefreshResult? = null

    fun refresh(failedAccess: String, read: () -> TokenStore.Session?, renew: (String) -> ApiResult,
        replace: (TokenStore.Session, TokenStore.Session) -> Boolean, clear: (TokenStore.Session) -> Unit,
        parse: (JSONObject) -> TokenStore.Session): SessionManager.RefreshResult {
        val observed = generation
        synchronized(this) {
            if (observed != generation && lastAccess == failedAccess) {
                val current = read() ?: return SessionManager.RefreshResult(null, 401)
                return if (current.access != failedAccess) SessionManager.RefreshResult(current.access, 200) else lastResult!!
            }
            val old = read() ?: return SessionManager.RefreshResult(null, 401)
            if (old.access != failedAccess) return SessionManager.RefreshResult(old.access, 200)
            val result = renew(old.refresh)
            val outcome = if (!result.successful) {
                if (result.status == 400 || result.status == 401) clear(old)
                SessionManager.RefreshResult(null, result.status)
            } else {
                val replacement = runCatching { parse(result.body!!) }.getOrNull()
                if (replacement == null) SessionManager.RefreshResult(null, 0)
                else if (replace(old, replacement)) SessionManager.RefreshResult(replacement.access, 200)
                else SessionManager.RefreshResult(null, 401)
            }
            lastAccess = failedAccess
            lastResult = outcome
            generation++
            return outcome
        }
    }
}
