package br.com.alocca.plantoes

import android.content.Context

/** Consulta paginada, isolada por sessão, sem confirmar leitura ao notificar. */
internal object NotificacoesSincronizador {
    const val NOME_TRABALHO = "alocca_inbox_sync"

    @Synchronized
    fun sincronizar(context: Context): Boolean {
        val revisao = PreferenciasLocais.revisao
        if (PreferenciasLocais.alterando) return false
        val inicial = Sessao.tokenVigente(context) ?: return TokenStore.read(context) == null
        val conta = Sessao.usuarioIdDoToken(inicial) ?: return false
        val sid = Sessao.sidDoToken(inicial) ?: Sessao.hashSessao(inicial)
        fun mesmaSessao(token: String?): Boolean = token != null &&
            Sessao.usuarioIdDoToken(token) == conta &&
            (Sessao.sidDoToken(token) ?: Sessao.hashSessao(token)) == sid
        fun tokenAtual(): String? = Sessao.tokenVigente(context)?.takeIf { mesmaSessao(it) }
        var token = tokenAtual() ?: return false
        val preferencias = NotificacoesApi.preferencias(token)
        if (preferencias is Resposta.Falha && preferencias.status == 401) {
            if (!Sessao.renovarAposFalha(context, token)) return false
            token = tokenAtual() ?: return false
        }
        val pref = if (preferencias is Resposta.Ok) preferencias else NotificacoesApi.preferencias(token)
        if (pref !is Resposta.Ok) return false
        var cursor: String? = null
        val cursores = mutableSetOf<String>()
        PublicacoesNotificacao(context).use { publicacoes ->
            do {
                token = tokenAtual() ?: return false
                var resultado = NotificacoesApi.listar(token, cursor, somenteNaoLidas = true, limite = 100)
                if (resultado is Resposta.Falha && resultado.status == 401 && Sessao.renovarAposFalha(context, token)) {
                    token = tokenAtual() ?: return false
                    resultado = NotificacoesApi.listar(token, cursor, somenteNaoLidas = true, limite = 100)
                }
                if (resultado !is Resposta.Ok) return false
                val pagina = resultado.dados
                // Mesmo monitor do save/clear: logout não pode entrar entre validação e publicação.
                synchronized(TokenStore) {
                    if (PreferenciasLocais.alterando || PreferenciasLocais.revisao != revisao) return false
                    if (!mesmaSessao(TokenStore.read(context))) return false
                    if (cursor == null) NotificacoesCentral.atualizar(pagina.naoLidas ?: contarNaoLidas(pagina.itens))
                    if (pref.dados.push) pagina.itens.filter { it.naoLida }.forEach { item ->
                        if (!publicacoes.contem(conta, item.id) && NotificadorLocal.publicar(
                            context, item.id, "Alocca", NotificadorLocal.TEXTO_GENERICO, DeepLink.validar(item.plantaoId),
                        )) publicacoes.registrar(conta, item.id)
                    }
                }
                cursor = pagina.nextCursor
                if (cursor != null && !cursores.add(cursor!!)) return false
            } while (cursor != null)
        }
        return true
    }

    internal fun filtrarNovos(vistos: Set<String>, itens: List<NotificacaoInbox>): List<NotificacaoInbox> =
        itens.filter { it.naoLida && it.id !in vistos }
}
