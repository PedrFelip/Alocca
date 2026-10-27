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
    private const val LEGACY_PREFS_NAME = "alocca"
    private const val LEGACY_TOKEN_KEY = "access_token"
    private const val TRANSFORMATION = "AES/GCM/NoPadding"
    private const val GCM_TAG_BITS = 128

    @Synchronized
    fun save(context: Context, token: String) {
        require(token.isNotBlank()) { "Token must not be blank" }

        // Remove tokens written by the previous plaintext implementation. Never read them.
        check(discardLegacyPlaintext(context)) { "Could not remove legacy token" }

        val cipher = Cipher.getInstance(TRANSFORMATION)
        cipher.init(Cipher.ENCRYPT_MODE, getOrCreateKey())
        val ciphertext = cipher.doFinal(token.toByteArray(Charsets.UTF_8))
        val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        val saved = prefs.edit()
            .putString(IV_KEY, Base64.encodeToString(cipher.iv, Base64.NO_WRAP))
            .putString(CIPHERTEXT_KEY, Base64.encodeToString(ciphertext, Base64.NO_WRAP))
            .commit()
        check(saved) { "Could not persist encrypted token" }
    }

    @Synchronized
    fun discardLegacyPlaintext(context: Context): Boolean =
        context.getSharedPreferences(LEGACY_PREFS_NAME, Context.MODE_PRIVATE)
            .edit().remove(LEGACY_TOKEN_KEY).commit()

    /** Remove a sessão local. Retorna `false` se a exclusão em disco falhar. */
    @Synchronized
    fun clear(context: Context): Boolean {
        val removido = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            .edit().remove(IV_KEY).remove(CIPHERTEXT_KEY).commit()
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
        val ivText = prefs.getString(IV_KEY, null)
        val ciphertextText = prefs.getString(CIPHERTEXT_KEY, null)
        if (ivText == null && ciphertextText == null) return null
        if (ivText == null || ciphertextText == null) {
            clearEncryptedToken(prefs)
            return null
        }

        return try {
            val iv = Base64.decode(ivText, Base64.NO_WRAP)
            val ciphertext = Base64.decode(ciphertextText, Base64.NO_WRAP)
            val cipher = Cipher.getInstance(TRANSFORMATION)
            cipher.init(Cipher.DECRYPT_MODE, getOrCreateKey(), GCMParameterSpec(GCM_TAG_BITS, iv))
            cipher.doFinal(ciphertext).toString(Charsets.UTF_8).takeIf(String::isNotBlank)
                ?: run { clearEncryptedToken(prefs); null }
        } catch (_: Exception) {
            // Includes key invalidation and authentication-tag failure. Do not fall back to plaintext.
            clearEncryptedToken(prefs)
            null
        }
    }

    private fun clearEncryptedToken(prefs: android.content.SharedPreferences) {
        prefs.edit().remove(IV_KEY).remove(CIPHERTEXT_KEY).apply()
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
