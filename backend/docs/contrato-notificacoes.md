# Notificações

Todos os endpoints exigem `Authorization: Bearer <jwt>` de usuário ativo (médico ou gestor). A identidade vem do token. URLs abaixo seguem o prefixo configurado da API.

- `GET /notificacoes?pagina=1&limite=20`: `{ "dados": [{ "id": "uuid", "tipo": "ALOCACAO_APROVADA", "plantao_id": "uuid", "titulo": "Candidatura aprovada", "mensagem": "Sua candidatura ao plantão foi aprovada.", "lida_em": null, "created_at": "2026-01-01T00:00:00.000Z" }], "pagina": 1, "limite": 20, "total": 1, "ate": "2026-01-01T00:00:00.000Z" }`. Datas são ISO 8601 UTC; `lida_em` é string ou null. Ordem decrescente por criação e, em empate, por UUID. Página começa em 1; limite padrão 20, máximo 100. Valores inválidos retornam 400.
- `PATCH /notificacoes/:id/lida`: retorna o mesmo objeto; repetir preserva a primeira data de leitura. UUID inválido retorna 400; inexistente ou de outro usuário retorna 404.
- `GET /notificacoes/preferencias`: `{ "email_habilitado": false }` por padrão.
- `PUT /notificacoes/preferencias`: recebe e retorna `{ "email_habilitado": true }` (booleano obrigatório, sem campos adicionais). Esta preferência não afeta emails de segurança ou recuperação.

A caixa de entrada está sempre disponível: os eventos são inseridos na transação do fato e não dependem do worker. Tipos atuais: `ALOCACAO_APROVADA`, `CANDIDATURA_REJEITADA`, `PLANTAO_CANCELADO`, `PLANTAO_CONCLUIDO`. Eventos desconhecidos recebem texto genérico.

A listagem também retorna `ate` (instante ISO UTC). Nas páginas seguintes, envie esse valor em `?ate=...` para manter o corte temporal e impedir que eventos novos desloquem os resultados durante a navegação. Atualizar a caixa inicia uma nova navegação sem `ate`. O Android encerra o carregamento ao receber uma página menor que o limite. O corte não é um snapshot transacional: inserções com data retroativa ou transações antigas confirmadas depois ainda podem alterar a sequência.

## Operação

Execute as migrações. `NOTIFICACOES_EMAIL_HABILITADO=true` habilita envio; configure `SMTP_HOST`, `SMTP_PORT` e `SMTP_FROM`. `SMTP_USER` e `SMTP_PASS` são opcionais para relay sem autenticação e devem ser configurados juntos. Apenas eventos criados enquanto o envio global e a preferência individual estavam habilitados entram na fila; eventos anteriores à migração ficam apenas na caixa de entrada. Desativar a preferência descarta os envios pendentes. Uma mensagem já em envio pode ser entregue após a desativação. `NODE_ENV=test` desativa o timer.

O worker consulta a fila a cada 30 segundos e processa até dez eventos por lote. Uma transação curta reserva cada evento com `FOR UPDATE SKIP LOCKED`; SMTP roda fora dela. A reserva expira em dois minutos, permitindo recuperação após falhas. São permitidas até cinco tentativas, inclusive reservas interrompidas, com atraso exponencial de 30 segundos até uma hora. Ao atingir o limite, o evento permanece na caixa de entrada, mas sai da fila. Uma queda após a aceitação SMTP e antes da confirmação pode duplicar o email; a garantia é pelo menos uma vez. O desligamento aguarda o lote em andamento. Push depende de infraestrutura de provedor ainda não definida.
