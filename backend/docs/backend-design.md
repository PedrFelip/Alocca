# Limites de responsabilidade

Controllers validam HTTP/Zod e delegam os fluxos. AprovarCandidaturaUseCase coordena UC11; AlocacaoRepository contém SQL e recebe a mesma transação em todas as operações. A ordem de locks continua médico → plantão → candidatura. Pagamento, vagas, cascata e notificações continuam atômicos. O log de aprovação é emitido depois do commit.

CheckinService decide as regras de presença, horário e GPS; CheckinRepository concentra consultas e gravação. PerfilMedicoModule exporta a consulta de identidade médica para os módulos consumidores, sem depender das rotas administrativas. AcessoInstitucionalService exige perfil de gestor ativo e vínculo atual em gestores_instituicoes; criação ou propriedade histórica não substituem esse vínculo. UsuariosService usa UsuarioPublico com campos explicitamente permitidos.

## Recuperação de senha

Aplicar as migrações antes de iniciar a nova versão: bun run migrate.

O pedido persiste token hash e e-mail cifrado na mesma transação antes de retornar MSG-05. Não espera SMTP. EmailOutboxService processa até dez mensagens por lote a cada segundo; SKIP LOCKED permite várias instâncias. Falhas são reagendadas para 30 segundos depois. Mensagens entregues, invalidadas ou vencidas são removidas; a expiração do código continua em 15 minutos e o limite em três pedidos por conta.

EMAIL_OUTBOX_SECRET (opcional, mínimo 32 caracteres) cifra os payloads com AES-256-GCM. Sem ele, a chave é derivada de JWT_SECRET. Configure uma chave estável e igual em todas as instâncias; trocá-la com mensagens pendentes impede sua decifragem. Payloads nunca são registrados em logs. SMTP ausente mantém os pedidos para retry, sem marcar entrega falsa.

A entrega tem semântica de pelo menos uma vez: queda após aceitação SMTP e antes do commit pode repetir o mesmo e-mail. O retry preserva o código e sua expiração. O worker respeita os timeouts SMTP e aguarda o lote em andamento ao fechar a aplicação. NODE_ENV=test desativa o timer; testes executam processar() explicitamente.

As notificações de plantão usam caixa de entrada e worker SMTP separados da recuperação; veja `contrato-notificacoes.md`.
