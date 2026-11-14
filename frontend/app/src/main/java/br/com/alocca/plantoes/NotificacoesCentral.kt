package br.com.alocca.plantoes

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

/**
 * Estado compartilhado do badge de não lidas entre telas (médico e gestor).
 * `nulo` = ainda sem consulta nesta sessão; a falha preserva a última contagem
 * real — nunca finge zero. Atualizado pelo sincronizador (ao abrir o app e no
 * worker periódico) e localmente ao marcar lida no painel.
 */
internal object NotificacoesCentral {
    private val _naoLidas = MutableStateFlow<Int?>(null)
    val naoLidas: StateFlow<Int?> = _naoLidas.asStateFlow()

    /** Contagem autenticada recebida do servidor (`nao_lidas` da página). */
    fun atualizar(contagem: Int) {
        if (contagem >= 0) _naoLidas.value = contagem
    }

    /** Painel confirmou a leitura: decrementa localmente até a próxima sync. */
    fun registrarLeitura() {
        val atual = _naoLidas.value ?: return
        if (atual > 0) _naoLidas.value = atual - 1
    }

    /** Logout / troca de conta / sessão expirada: zera o estado da sessão anterior. */
    fun aoSair() {
        _naoLidas.value = null
    }
}
