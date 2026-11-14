package br.com.alocca.plantoes

/**
 * Deep link seguro para o plantão de uma notificação: o valor recebido (payload
 * push ou clique no inbox) só navega se for um UUID. Nada do payload é confiado
 * como conteúdo — o plantão exibido é sempre carregado pela API autenticada.
 */
internal object DeepLink {
    private val UUID = Regex("^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$")

    /** Devolve o id normalizado (minúsculo) ou nulo quando inválido/estranho. */
    fun validar(valor: String?): String? {
        val id = valor?.trim().orEmpty()
        return id.lowercase().takeIf { UUID.matches(it) }
    }
}
