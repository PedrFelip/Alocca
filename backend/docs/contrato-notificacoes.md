# Notificações

Todos os endpoints exigem `Authorization: Bearer <jwt>` de usuário ativo (médico ou gestor). A identidade vem do token. URLs abaixo seguem o prefixo configurado da API.

- `GET /notificacoes?pagina=1&limite=20`: `{ "dados": [{ "id": "uuid", "tipo": "ALOCACAO_APROVADA", "plantao_id": "uuid", "titulo": "Candidatura aprovada", "mensagem": "Sua candidatura ao plantão foi aprovada.", "lida_em": null, "created_at": "2026-01-01T00:00:00.000Z" }], "pagina": 1, "limite": 20, "total": 1 }`. Datas são ISO 8601 UTC; `lida_em` é string ou null. Ordem decrescente por criação e, em empate, por UUID. Página começa em 1; limite padrão 20, máximo 100. Valores inválidos retornam 400.
- `PATCH /notificacoes/:id/lida`: retorna o mesmo objeto; repetir preserva a primeira data de leitura. UUID inválido retorna 400; inexistente ou de outro usuário retorna 404.
- `GET /notificacoes/preferencias`: `{ "email_habilitado": false }` por padrão.
- `PUT /notificacoes/preferencias`: recebe e retorna `{ "email_habilitado": true }` (booleano obrigatório, sem campos adicionais). Esta preferência não afeta emails de segurança ou recuperação.

A caixa de entrada está sempre disponível: os eventos são inseridos na transação do fato e não dependem do worker. Tipos atuais: `ALOCACAO_APROVADA`, `CANDIDATURA_REJEITADA`, `PLANTAO_CANCELADO`, `PLANTAO_CONCLUIDO`. Eventos desconhecidos recebem texto genérico.

A listagem também retorna `ate` (instante ISO UTC). Nas páginas seguintes, envie esse valor em `?ate=...` para manter o corte temporal e impedir que eventos novos desloquem os resultados durante a navegação. Atualizar a caixa inicia uma nova navegação sem `ate`. O Android encerra o carregamento ao receber uma página menor que o limite. O corte não é um snapshot transacional: inserções com data retroativa ou transações antigas confirmadas depois ainda podem alterar a sequência.

## Operação

Execute as migrações. O envio de email de notificações é opcional e desativado por padrão; configure `NOTIFICACOES_EMAIL_HABILITADO=true` e `SMTP_HOST`, `SMTP_PORT`, `SMTP_FROM` `SMTP_USER` e `SMTP_PASS`. A preferência individual também deve estar habilitada. Sem SMTP configurado a tentativa falha e permanece pendente, nunca é marcada enviada. Uma preferência desativada deixa eventos pendentes; ao ativá-la, eventos antigos pendentes também são elegíveis. Desativar a variável do ambiente pausa o worker sem impedir a caixa de entrada. `NODE_ENV=test` desativa o timer.

O worker processa até dez eventos por lote, com trava `FOR UPDATE SKIP LOCKED`, uma transação por email e apenas um lote simultâneo por instância. Falhas aguardam 30 segundos, dobrando até o teto de uma hora, sem limite de tentativas. A confirmação SMTP marca o evento enviado; sucesso não é reenviado durante operação normal. Uma queda depois da aceitação SMTP e antes do commit pode causar duplicata: a garantia é **pelo menos uma vez**, não entrega exatamente uma vez. O SMTP pode aceitar uma mensagem sem garantir entrega final. O desligamento aguarda o lote em andamento. Push depende de infraestrutura e credenciais de provedor ainda não existentes e não está implementado.
