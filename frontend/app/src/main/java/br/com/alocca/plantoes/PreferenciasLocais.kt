package br.com.alocca.plantoes

/** Interrompe publicações baseadas em preferência anterior durante um PUT local. */
internal object PreferenciasLocais {
    @Volatile var revisao = 0; private set
    @Volatile var alterando = false; private set
    fun iniciarAlteracao() = synchronized(TokenStore) { revisao++; alterando = true }
    fun finalizarAlteracao() = synchronized(TokenStore) { revisao++; alterando = false }
}
