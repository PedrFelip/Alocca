package br.com.alocca.plantoes

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/** Stores only AES-GCM ciphertext in preferences; the AES key is held by Android Keystore. */
internal object TokenStore {
    private const val KEY_ALIAS = "alocca_access_token_v1"
    private const val PREFS_NAME = "alocca_secure"
    private const val IV_KEY = "access_token_iv"
    private const val CIPHERTEXT_KEY = "access_token_ciphertext"
    private const val REFRESH_IV_KEY = "refresh_token_iv"
    private const val REFRESH_CIPHERTEXT_KEY = "refresh_token_ciphertext"
    private const val LEGACY_PREFS_NAME = "alocca"
    private const val LEGACY_TOKEN_KEY = "access_token"
    private const val TRANSFORMATION = "AES/GCM/NoPadding"
    private const val GCM_TAG_BITS = 128

    @Synchronized
    fun save(context: Context, token: String) {
        require(token.isNotBlank()) { "Token must not be blank" }

        // Remove tokens written by the previous plaintext implementation. Never read them.
        check(discardLegacyPlaintext(context)) { "Could not remove legacy token" }

        val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        guardar(prefs, IV_KEY, CIPHERTEXT_KEY, token)
    }

    /** Refresh token rotativo, no mesmo cofre do Keystore que o access token. */
    @Synchronized
    fun salvarRefresh(context: Context, token: String) {
        require(token.isNotBlank()) { "Refresh token must not be blank" }
        val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        guardar(prefs, REFRESH_IV_KEY, REFRESH_CIPHERTEXT_KEY, token)
    }

    /**
     * Grava o PAR (access, refresh) em UMA transação: um commit só cobre os
     * quatro valores, então nunca fica em disco um access novo com refresh
     * velho (ou o contrário) — o intervalo entre gravações separadas deixaria
     * um refresh rotativo já consumido apontando para a sessão anterior.
     * CAS com `esperadoAnterior`: só grava se o access em disco ainda for o
     * que pediu a renovação (logout/troca de conta no intervalo ganha).
     */
    @Synchronized
    fun salvarSessao(
        context: Context,
        access: String,
        refresh: String,
        esperadoAnterior: String? = null,
    ): Boolean {
        require(access.isNotBlank() && refresh.isNotBlank()) { "Tokens must not be blank" }
        if (esperadoAnterior != null && read(context) != esperadoAnterior) return false

        // Cifra os dois ANTES do commit: nada parcial fica em disco.
        val accessCifrado = cifrar(access)
        val refreshCifrado = cifrar(refresh)
        check(discardLegacyPlaintext(context)) { "Could not remove legacy token" }
        val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        val saved = prefs.edit()
            .putString(IV_KEY, accessCifrado.first)
            .putString(CIPHERTEXT_KEY, accessCifrado.second)
            .putString(REFRESH_IV_KEY, refreshCifrado.first)
            .putString(REFRESH_CIPHERTEXT_KEY, refreshCifrado.second)
            .commit()
        check(saved) { "Could not persist session" }
        return true
    }

    /** Cifra `valor`; devolve (iv, ciphertext) em Base64. Falha de disco/keystore lança. */
    private fun cifrar(valor: String): Pair<String, String> {
        val cipher = Cipher.getInstance(TRANSFORMATION)
        cipher.init(Cipher.ENCRYPT_MODE, getOrCreateKey())
        val ciphertext = cipher.doFinal(valor.toByteArray(Charsets.UTF_8))
        return Base64.encodeToString(cipher.iv, Base64.NO_WRAP) to
            Base64.encodeToString(ciphertext, Base64.NO_WRAP)
    }

    @Synchronized
    fun lerRefresh(context: Context): String? {
        val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        return recuperar(prefs, REFRESH_IV_KEY, REFRESH_CIPHERTEXT_KEY)
    }

    @Synchronized
    fun limparRefresh(context: Context): Boolean =
        context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            .edit().remove(REFRESH_IV_KEY).remove(REFRESH_CIPHERTEXT_KEY).commit()

    @Synchronized
    fun discardLegacyPlaintext(context: Context): Boolean =
        context.getSharedPreferences(LEGACY_PREFS_NAME, Context.MODE_PRIVATE)
            .edit().remove(LEGACY_TOKEN_KEY).commit()

    /** Remove a sessão local. Retorna `false` se a exclusão em disco falhar. */
    @Synchronized
    fun clear(context: Context): Boolean {
        val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        val removido = prefs.edit()
            .remove(IV_KEY).remove(CIPHERTEXT_KEY)
            .remove(REFRESH_IV_KEY).remove(REFRESH_CIPHERTEXT_KEY)
            .commit()
        return removido && discardLegacyPlaintext(context)
    }

    /**
     * Encerra a sessão local apenas se o token salvo ainda for o consultado.
     * Impede que uma restauração antiga apague o token de uma sessão mais nova:
     * a comparação e a remoção são atômicas (mesmo lock do save/read).
     */
    @Synchronized
    fun clearIfMatches(context: Context, token: String): Boolean {
        if (token.isBlank()) return false
        if (read(context) != token) return false
        return clear(context)
    }

    /** Returns null for an absent or undecryptable token and clears corrupt ciphertext. */
    @Synchronized
    fun read(context: Context): String? {
        val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        return recuperar(prefs, IV_KEY, CIPHERTEXT_KEY)
    }

    /** Grava `valor` cifrado (AES-GCM, chave do Keystore); falha de disco lança. */
    private fun guardar(prefs: android.content.SharedPreferences, ivKey: String, cipherKey: String, valor: String) {
        val cipher = Cipher.getInstance(TRANSFORMATION)
        cipher.init(Cipher.ENCRYPT_MODE, getOrCreateKey())
        val ciphertext = cipher.doFinal(valor.toByteArray(Charsets.UTF_8))
        val saved = prefs.edit()
            .putString(ivKey, Base64.encodeToString(cipher.iv, Base64.NO_WRAP))
            .putString(cipherKey, Base64.encodeToString(ciphertext, Base64.NO_WRAP))
            .commit()
        check(saved) { "Could not persist encrypted token" }
    }

    /** Lê e decifra; valor corrompido é apagado e tratado como ausente. */
    private fun recuperar(prefs: android.content.SharedPreferences, ivKey: String, cipherKey: String): String? {
        val ivText = prefs.getString(ivKey, null)
        val ciphertextText = prefs.getString(cipherKey, null)
        if (ivText == null && ciphertextText == null) return null
        if (ivText == null || ciphertextText == null) {
            apagar(prefs, ivKey, cipherKey)
            return null
        }

        return try {
            val iv = Base64.decode(ivText, Base64.NO_WRAP)
            val ciphertext = Base64.decode(ciphertextText, Base64.NO_WRAP)
            val cipher = Cipher.getInstance(TRANSFORMATION)
            cipher.init(Cipher.DECRYPT_MODE, getOrCreateKey(), GCMParameterSpec(GCM_TAG_BITS, iv))
            cipher.doFinal(ciphertext).toString(Charsets.UTF_8).takeIf(String::isNotBlank)
                ?: run { apagar(prefs, ivKey, cipherKey); null }
        } catch (_: Exception) {
            // Includes key invalidation and authentication-tag failure. Do not fall back to plaintext.
            apagar(prefs, ivKey, cipherKey)
            null
        }
    }

    private fun apagar(prefs: android.content.SharedPreferences, ivKey: String, cipherKey: String) {
        prefs.edit().remove(ivKey).remove(cipherKey).apply()
    }

    private fun getOrCreateKey(): SecretKey {
        val keyStore = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (keyStore.getKey(KEY_ALIAS, null) as? SecretKey)?.let { return it }

        val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
        generator.init(
            KeyGenParameterSpec.Builder(
                KEY_ALIAS,
                KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT,
            )
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setRandomizedEncryptionRequired(true)
                .build(),
        )
        return generator.generateKey()
    }
}
