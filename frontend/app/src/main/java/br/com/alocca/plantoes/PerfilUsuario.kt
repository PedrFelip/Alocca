package br.com.alocca.plantoes

import org.json.JSONObject

/** Dados mínimos da sessão usados pela tela autenticada. */
internal data class PerfilUsuario(
    val id: String,
    val nome: String,
    val email: String,
    val tipo: String,
    val status: String,
    val crm: String?,
    val ufCrm: String?,
    val statusValidacao: String?,
    val motivoRejeicao: String?,
) {
    val tipoDescricao: String
        get() = when (tipo) {
            "MEDICO" -> "Médico"
            "GESTOR" -> "Gestor"
            "ADMIN" -> "Administrador"
            else -> tipo
        }

    val statusDescricao: String
        get() = when (status) {
            "ATIVO" -> "Ativa"
            "INATIVO" -> "Inativa"
            "BLOQUEADO" -> "Bloqueada"
            else -> status
        }

    val validacaoDescricao: String
        get() = when (statusValidacao) {
            "PENDENTE" -> "Em análise"
            "APROVADO" -> "Aprovado"
            "REJEITADO" -> "Rejeitado"
            else -> "Não informado"
        }

    companion object {
        fun fromJson(user: JSONObject?): PerfilUsuario? {
            if (user == null) return null
            val id = user.stringOrNull("id") ?: return null
            val nome = user.stringOrNull("nome") ?: return null
            val email = user.stringOrNull("email") ?: return null
            val tipo = user.stringOrNull("tipo") ?: return null
            val status = user.stringOrNull("status") ?: return null
            val medico = user.optJSONObject("medico")
            return PerfilUsuario(
                id = id,
                nome = nome,
                email = email,
                tipo = tipo,
                status = status,
                crm = medico?.stringOrNull("crm"),
                ufCrm = medico?.stringOrNull("uf_crm"),
                statusValidacao = medico?.stringOrNull("status_validacao"),
                motivoRejeicao = medico?.stringOrNull("motivo_rejeicao"),
            )
        }

        fun fromLoginResponse(response: JSONObject?): PerfilUsuario? =
            response?.optJSONObject("usuario")?.let { fromJson(it) }
    }
}

private fun JSONObject.stringOrNull(name: String): String? {
    // JSONObject.optString devolve "null" para valores JSON null em versões do Android.
    if (isNull(name)) return null
    return optString(name).trim().takeIf(String::isNotBlank)
}
