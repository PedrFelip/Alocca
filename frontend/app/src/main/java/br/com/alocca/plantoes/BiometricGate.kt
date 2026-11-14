package br.com.alocca.plantoes

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import androidx.biometric.BiometricManager
import androidx.biometric.BiometricPrompt
import androidx.core.content.ContextCompat
import androidx.fragment.app.FragmentActivity
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/** A sessão só é consultada depois de decifrar este marcador com autenticação forte. */
internal object BiometricGate {
    private const val PREFS = "biometric_gate"
    private const val ALIAS = "alocca_biometric_gate_v1"
    private const val MARKER = "alocca-unlock-v1"
    private const val TRANSFORM = "AES/GCM/NoPadding"
    private fun prefs(context: Context) = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    fun enabled(context: Context): Boolean = prefs(context).contains("ciphertext")
    fun available(context: Context): Boolean = BiometricManager.from(context)
        .canAuthenticate(BiometricManager.Authenticators.BIOMETRIC_STRONG) == BiometricManager.BIOMETRIC_SUCCESS

    fun clear(context: Context) {
        prefs(context).edit().clear().commit()
        runCatching { KeyStore.getInstance("AndroidKeyStore").apply { load(null); deleteEntry(ALIAS) } }
    }

    fun enable(activity: FragmentActivity, done: (Boolean, String) -> Unit) {
        if (!available(activity)) { done(false, "Biometria forte indisponível ou não cadastrada neste dispositivo."); return }
        try {
            clear(activity)
            val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
            generator.init(KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setUserAuthenticationRequired(true)
                .setInvalidatedByBiometricEnrollment(true)
                .build())
            val cipher = Cipher.getInstance(TRANSFORM).apply { init(Cipher.ENCRYPT_MODE, generator.generateKey()) }
            prompt(activity, cipher) { authenticated, message ->
                try {
                    if (authenticated == null) { clear(activity); done(false, message) }
                    else {
                        val encrypted = authenticated.doFinal(MARKER.toByteArray(Charsets.UTF_8))
                        val saved = prefs(activity).edit().putString("iv", Base64.encodeToString(authenticated.iv, Base64.NO_WRAP))
                            .putString("ciphertext", Base64.encodeToString(encrypted, Base64.NO_WRAP)).commit()
                        if (!saved) clear(activity)
                        done(saved, if (saved) "Biometria ativada neste dispositivo." else "Não foi possível ativar a biometria.")
                    }
                } catch (_: Exception) { clear(activity); done(false, "Não foi possível ativar a biometria.") }
            }
        } catch (_: Exception) { clear(activity); done(false, "Não foi possível ativar a biometria neste dispositivo.") }
    }

    fun unlock(activity: FragmentActivity, done: (Boolean, String) -> Unit) {
        if (!available(activity)) { done(false, "Biometria indisponível. Entre novamente com seu PIN."); return }
        try {
            val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
            val key = store.getKey(ALIAS, null) as SecretKey
            val iv = Base64.decode(prefs(activity).getString("iv", null), Base64.NO_WRAP)
            val encrypted = Base64.decode(prefs(activity).getString("ciphertext", null), Base64.NO_WRAP)
            val cipher = Cipher.getInstance(TRANSFORM).apply { init(Cipher.DECRYPT_MODE, key, GCMParameterSpec(128, iv)) }
            prompt(activity, cipher) { authenticated, message ->
                val valid = authenticated != null && runCatching {
                    authenticated.doFinal(encrypted).toString(Charsets.UTF_8) == MARKER
                }.getOrDefault(false)
                done(valid, if (valid) "" else message.ifBlank { "Não foi possível desbloquear. Entre novamente com seu PIN." })
            }
        } catch (_: Exception) { done(false, "Biometria indisponível ou alterada. Entre novamente com seu PIN.") }
    }

    private fun prompt(activity: FragmentActivity, cipher: Cipher, done: (Cipher?, String) -> Unit) {
        val prompt = BiometricPrompt(activity, ContextCompat.getMainExecutor(activity), object : BiometricPrompt.AuthenticationCallback() {
            override fun onAuthenticationError(errorCode: Int, errString: CharSequence) { done(null, errString.toString()) }
            override fun onAuthenticationSucceeded(result: BiometricPrompt.AuthenticationResult) { done(result.cryptoObject?.cipher, "") }
        })
        val info = BiometricPrompt.PromptInfo.Builder().setTitle("Desbloquear Alocca")
            .setSubtitle("Confirme sua biometria neste dispositivo")
            .setAllowedAuthenticators(BiometricManager.Authenticators.BIOMETRIC_STRONG)
            .setNegativeButtonText("Cancelar").build()
        prompt.authenticate(info, BiometricPrompt.CryptoObject(cipher))
    }
}
