# Notificações — D10 e contrato Android

## Arquitetura e garantias

A outbox UC11 continua na mesma transação da alocação. Rollback não gera envio. A API não chama provedores: o processo separado `bun run worker:notificacoes` expande eventos em entregas de e-mail e consome a fila PostgreSQL. Em produção, após build: `bun run worker:notificacoes:prod`. Execute pelo menos uma instância e monitore seu supervisor; não há worker automático dentro da API.

A expansão reserva até 100 eventos com `FOR UPDATE SKIP LOCKED`, grava entregas com chave única evento/canal/destino e marca `processada_at` atomicamente. A inbox existe independentemente das preferências de app e e-mail. Preferências padrão: notificações do app e e-mail desligados; só eventos expandidos após ativação originam entregas externas. A preferência de e-mail é reavaliada antes de cada envio, permitindo cancelar entregas pendentes. O Android consulta a preferência do app antes de publicar localmente.

Cada worker reserva no máximo `NOTIFICATIONS_CONCURRENCY` entregas (padrão 8, limite 32). A reserva é atômica, sem I/O externo dentro da transação. Lease de 120 segundos permite recuperar processo que morreu; `lease_id` impede que o dono antigo finalize uma reserva retomada. Finalização da entrega e status da outbox compartilham transação, evitando sucesso parcial no banco. Não há sobreposição de ciclos na mesma instância. O polling ocioso é configurável em `NOTIFICATIONS_POLL_MS` (padrão 2000); com backlog o próximo lote começa imediatamente. Índices cobrem expansão, fila, lease, inbox e não lidas. SMTP usa pool limitado. Não há Firebase, FCM nem registro de token de dispositivo.

**Entrega externa é pelo menos uma vez, nunca exatamente uma vez.** Crash/pausa após o provedor aceitar e antes do commit pode duplicar. SMTP usa Message-ID estável, mas isso não obriga o destinatário a deduplicar. Android substitui a notificação pelo ID do evento. Fencing protege o estado do banco e não desfaz um envio já iniciado. `ENVIADA` significa aceite pelo provedor, não leitura ou exibição comprovada. Não há webhook de abertura/bounce.

Estados por entrega: `PENDENTE`, `PROCESSANDO`, `ENVIADA`, `CANCELADA`, `FALHOU`, `BLOQUEADA`. Falhas transitórias recebem até 8 tentativas, espera exponencial de 30s até 1h com jitter. Falhas permanentes encerram tentativas. Configuração ausente/incorreta bloqueia, nunca simula envio. Após corrigir a configuração, reprocessar explicitamente: `bun run notificacoes:reprocessar <uuid-da-entrega>`. A operação só aceita BLOQUEADA/FALHOU e registra o ID; nunca reenvia ENVIADA.

O campo legado `notificacoes.status` só vira ENVIADA quando todas as entregas externas do evento foram aceitas. `processada_at` distingue evento já expandido de backlog; eventos sem canal habilitado ou com entrega cancelada não recebem sucesso fictício.

Postgres evita a necessidade inicial de Redis e de sincronização entre outbox e outra fila. Escalar workers aumenta vazão até os limites do banco/provedores; limites de concorrência devem ser dimensionados com métricas e quotas. Particionamento/retenção e broker externo são próximos passos quando medições justificarem. Não há benchmark de capacidade de produção nesta entrega.

## Configuração

SMTP usa SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS e SMTP_FROM; porta 465 usa TLS direto. Credenciais são exclusivamente do ambiente, nunca do repositório. O Android usa a API autenticada existente, sem credenciais de provedor de push. Arquivos secretos devem ficar fora do Git, com permissão restrita.

SIGTERM/SIGINT interrompem o polling, deixam o lote atual terminar e fecham pool SMTP e banco. Logs JSON de entrega têm ID da entrega, canal, estado, tentativa, código sanitizado e duração. A cada minuto o worker registra totais por estado e idade máxima dos eventos; não registra destinatário, token, payload, resposta bruta do provedor ou segredo. Alertar para worker ausente, crescimento da idade da fila e estados FALHOU/BLOQUEADA. As métricas agregadas leem histórico; definir retenção conforme volume antes de operar em grande escala.

## API autenticada

Todos os endpoints usam `Authorization: Bearer <access_token>`. O usuário vem da autenticação; não aceitar usuario_id enviado pelo cliente.

- `GET /notificacoes?limite=20&cursor=<uuid>`: limite 1–100; `{items:[{id,tipo,plantao_id,created_at,lida_at}],next_cursor,nao_lidas}`. Ordem created_at/id decrescente. Cursor de outro usuário não revela registros. Contagem e lista são consultas separadas e podem refletir momentos ligeiramente diferentes com novos eventos concorrentes.
- `PATCH /notificacoes/:id/lida`: leitura idempotente, 404 para item de outra conta.
- `GET /notificacoes/plantoes/:id`: detalhe do plantão selecionado, somente se existir uma notificação destinada ao usuário para esse plantão; 404 para outra conta.
- `GET /notificacoes/preferencias` e `PUT /notificacoes/preferencias`: `{push:boolean,email:boolean}`, persistência real.
- `GET /notificacoes?somente_nao_lidas=true&limite=100&cursor=<uuid>`: mesmo contrato, filtra não lidas para sincronização Android. Não marca como lida ao publicar na bandeja.

`push` é o nome legado do campo de preferência no JSON; nesta decisão significa **notificações locais do app**, sem transporte push externo.

## Sessões e Android

Login retorna access_token de curta duração e refresh_token opaco. `POST /auth/refresh` recebe `{refresh_token}` e rotaciona o refresh em transação, retornando a mesma estrutura de sessão do login. `POST /auth/logout` autenticado revoga a sessão. JWT leva sid; refresh só tem hash SHA256 armazenado no servidor. Reset de senha revoga sessões e JWTs legados; criação de sessão revalida o hash de senha sob lock do usuário para serializar com reset. O prazo de refresh é configurável por `REFRESH_TOKEN_TTL_SECONDS`, padrão 30 dias (2592000s), decisão operacional para permitir sincronização sem login a cada 15 minutos. Não prolonga a validade do JWT. Conta inativa/excluída e sessão revogada não renovam.

WorkManager agenda consulta periódica com rede disponível, intervalo mínimo de 15 minutos, e há sincronização ao abrir o app. Não há conexão permanente nem foreground service. Android pode adiar por Doze, bateria ou rede; não existe garantia de entrega imediata. Force-stop impede execução até abrir o app novamente.

O worker percorre as páginas não lidas e mantém IDs já publicados em armazenamento local, separados por conta. Valida a sessão antes/depois da requisição, respeita preferência persistida e POST_NOTIFICATIONS e publica notificação nativa no canal `alocca_atualizacoes`. Título/corpo genéricos protegem tela bloqueada; tocar constrói rota interna a partir de UUID validado e a tela consulta API autenticada. Logout cancela trabalho e limpa notificações locais; a sessão é revogada no servidor quando a rede permite. Refresh/access ficam criptografados pelo Android Keystore.

## Validação reproduzível

Na raiz: `docker compose -p alocca-notifications-qa -f compose.notifications-test.yaml up -d --wait`.

Em backend: `NOTIFICATIONS_TEST_DATABASE_URL=postgresql://alocca_test:local-notifications-test@127.0.0.1:55439/postgres bun run test:e2e -- test/notificacoes-postgres.e2e-spec.ts`. Cria/apaga banco próprio, aplica todas as migrations, usa PostgreSQL 17 e Mailpit reais em Docker. A variável é opt-in para não tocar DATABASE_URL da aplicação. Credenciais desse Compose são locais, apenas de teste, portas em loopback.

Os testes exercitam rollback, expansão idempotente, SKIP LOCKED em conexões distintas, claims concorrentes, recuperação de lease/fencing, retry e captura SMTP no Mailpit, preferências, envio em processo separado e encerramento SIGTERM. Há falha temporária injetada e servidor SMTP real de teste respondendo 451 para validar a classificação transitória. Testes HTTP adicionais com PGlite cobrem autenticação, validação, paginação e isolamento. Gmail teve TLS/autenticação verificados separadamente; isso não prova recebimento de e-mail. Notificação local no Android é validada separadamente no emulador; não há dependência de Firebase.
