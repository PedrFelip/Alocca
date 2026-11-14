package br.com.alocca.plantoes

import android.content.Context
import org.json.JSONObject
import java.security.MessageDigest

/**
 * Sessão vigente: validação de JWT, hash/identificadores estáveis e renovação
 * sincronizada (rotativa) do par access/refresh token. O JWT tem 15 min e
 * `sid` estável; a renovação usa CAS para não desfazer logout/troca de conta
 * nem descartar renovação concorrente de outra thread.
 */
internal object Sessao {

    /** Huella SHA-256 do token; nunca expõe o JWT nem o guarda. */
    fun hashSessao(token: String): String =
        MessageDigest.getInstance("SHA-256")
            .digest(token.toByteArray(Charsets.UTF_8))
            .joinToString("") { "%02x".format(it) }

    /** Claims do payload do JWT; nulo se ilegível (falha fechada). */
    internal fun claimsDoJwt(token: String): JSONObject? {
        val partes = token.split('.')
        if (partes.size != 3) return null
        return runCatching {
            JSONObject(
                String(
                    android.util.Base64.decode(
                        partes[1],
                        android.util.Base64.URL_SAFE or android.util.Base64.NO_WRAP or android.util.Base64.NO_PADDING,
                    ),
                    Charsets.UTF_8,
                ),
            )
        }.getOrNull()
    }

    /** `sub` do JWT = id da conta (estável entre sessões e rotações). */
    fun usuarioIdDoToken(token: String): String? =
        claimsDoJwt(token)?.let { claims ->
            if (claims.isNull("sub")) null else claims.optString("sub").trim().takeIf(String::isNotBlank)
        }

    /** `sid` do JWT = id da sessão no servidor (estável entre rotações). */
    fun sidDoToken(token: String): String? =
        claimsDoJwt(token)?.let { claims ->
            if (claims.isNull("sid")) null else claims.optString("sid").trim().takeIf(String::isNotBlank)
        }

    fun mesmaSessao(primeiro: String?, segundo: String?): Boolean = primeiro != null && segundo != null &&
        usuarioIdDoToken(primeiro) == usuarioIdDoToken(segundo) &&
        (sidDoToken(primeiro) ?: hashSessao(primeiro)) == (sidDoToken(segundo) ?: hashSessao(segundo))

    fun <T> consultar(context: Context, esperado: String, pedido: (String) -> Resposta<T>): Resposta<T> {
        var token = tokenVigente(context)?.takeIf { mesmaSessao(esperado, it) }
            ?: return Resposta.Falha(NOTIFICACAO_MSG_SESSAO_EXPIRADA, 401)
        var resposta = pedido(token)
        if (resposta is Resposta.Falha && resposta.status == 401 && renovarAposFalha(context, token)) {
            token = tokenVigente(context)?.takeIf { mesmaSessao(esperado, it) }
                ?: return Resposta.Falha(NOTIFICACAO_MSG_SESSAO_EXPIRADA, 401)
            resposta = pedido(token)
        }
        return if (mesmaSessao(token, TokenStore.read(context))) resposta
            else Resposta.Falha(NOTIFICACAO_MSG_SESSAO_EXPIRADA, 401)
    }

    /** Expiração pelo claim `exp` (segundos). Ilegível/ausente = expirado. */
    internal fun jwtExpirado(token: String): Boolean {
        val claims = claimsDoJwt(token) ?: return true
        val exp = if (claims.isNull("exp")) -1L else claims.optLong("exp", -1L)
        return exp <= System.currentTimeMillis() / 1000L
    }

    /**
     * Token de acesso utilizável: renova (sincronizado) quando o JWT atual
     * está expirado. Nulo quando não há sessão ou a renovação falhou.
     */
    fun tokenVigente(context: Context): String? {
        if (TokenStore.read(context) == null) return null
        renovar(context)
        return TokenStore.read(context)?.takeIf { !jwtExpirado(it) }
    }

    data class Encerramento(val local: Boolean, val remoto: Boolean)

    @Synchronized
    fun encerrar(context: Context): Encerramento {
        val anterior = TokenStore.read(context)
        val token = tokenVigente(context)
        val remoto = when {
            anterior == null -> true
            token != null -> AuthApi.logout(token).successful
            TokenStore.read(context) == null -> true // refresh já revogado/expirado
            else -> false
        }
        val local = TokenStore.clear(context)
        if (local) NotificacoesAgenda.cancelar(context)
        return Encerramento(local, remoto)
    }

    /** Renovação preventiva: só age se o JWT atual está expirado. */
    @Synchronized
    fun renovar(context: Context): Boolean {
        val atual = TokenStore.read(context) ?: return false
        if (!jwtExpirado(atual)) return true // vigente ou outra thread acabou de renovar
        return renovarComCAS(context, atual)
    }

    /**
     * Renovação após 401: o JWT pode estar vigente localmente e revogado no
     * servidor — força a renovação com CAS; se outra thread já trocou o token,
     * não repete com o JWT falho.
     */
    @Synchronized
    fun renovarAposFalha(context: Context, tokenFalho: String): Boolean {
        val atual = TokenStore.read(context) ?: return false
        if (atual != tokenFalho) return true // outra thread já renovou
        return renovarComCAS(context, atual)
    }

    /**
     * Renovação de verdade com CAS: só persiste o novo par se a sessão local
     * ainda for a que pediu (logout/troca de conta no intervalo ganha).
     * Refresh inválido/revogado encerra a sessão local.
     */
    private fun renovarComCAS(context: Context, tokenEsperado: String): Boolean {
        val refresh = TokenStore.lerRefresh(context) ?: return false
        val resultado = AuthApi.refresh(refresh)
        if (!resultado.successful) {
            // Refresh inválido/expirado/revogado: a sessão acabou no servidor.
            if (resultado.status in 400..401) TokenStore.clearIfMatches(context, tokenEsperado)
            return false
        }
        val novoAcesso = resultado.body?.optString("access_token")?.trim().orEmpty()
        val novoRefresh = resultado.body?.optString("refresh_token")?.trim().orEmpty()
        if (novoAcesso.isBlank() || novoRefresh.isBlank()) return false
        if (PerfilUsuario.fromLoginResponse(resultado.body) == null) return false
        // CAS + gravação atômica do par: logout/troca no intervalo não é desfeito.
        return TokenStore.salvarSessao(context, novoAcesso, novoRefresh, esperadoAnterior = tokenEsperado)
    }
}
