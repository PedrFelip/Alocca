# Alocca — backend

API NestJS com PostgreSQL, Drizzle e validação Zod.

## Configuração

```sh
bun install
cp .env.example .env
openssl rand -hex 32
```

Configure `DATABASE_URL` e coloque o segredo gerado em `JWT_SECRET`.
O backend cria um administrador inicial ao iniciar, usando `ADMIN_EMAIL` e
`ADMIN_PASSWORD`. O exemplo local usa `admin@alocca.local` / `AloccaAdmin@2026`.
Use uma senha própria em produção. Remova ambas as variáveis para desabilitar
a criação automática. Aplique as migrações antes de iniciar o backend.
Uma conta existente com o mesmo e-mail nunca é promovida, reativada ou tem a
senha substituída. Reiniciar não duplica o admin; mudar o `.env` não redefine
a senha de uma conta que já existe.
`JWT_EXPIRES` define a duração do access token (padrão: 900 segundos).
`HOST` define a interface de rede em que a API escuta (padrão: `127.0.0.1`,
acessível somente na própria máquina). Para desenvolvimento com emulador ou
celular na rede local, habilite o acesso explicitamente com `HOST=0.0.0.0` e
use o IP da máquina que executa o backend. Antes de expor a API à rede, troque
as credenciais admin de exemplo do `.env.example`, configure um `JWT_SECRET`
próprio e limite o acesso pelo firewall.
`TRUST_PROXY` configura os IPs/sub-redes confiáveis do Express para que o throttle
use o IP do cliente encaminhado pelo proxy. Por padrão fica vazio (desabilitado).
Com Caddy/Nginx na mesma máquina, defina `TRUST_PROXY=loopback`; para proxies em
outra rede, informe seus IPs/CIDRs separados por vírgula. Restrinja o acesso direto
à API e configure o proxy para sobrescrever `X-Forwarded-For` com o IP do cliente.
Confie somente nos endereços dos proxies que você controla.

`ADMIN_WEB_ORIGIN` define a origem permitida pelo CORS para o painel Svelte
(padrão: `http://localhost:5173`). Configure a origem exata do painel em produção.
O app Android nativo não é limitado por CORS; mantenha esta origem restrita ao
painel web. Em dispositivos físicos, permita a porta da API no firewall da rede
local e use o endereço IP da máquina que executa o backend.

Na raiz do projeto, inicie o banco e o Redis local com
`docker compose up -d --wait db redis`.
A conexão padrão do `.env.example` corresponde ao serviço do Compose.

O Redis do Compose publica somente em `127.0.0.1:6379`, usa AOF com
`appendfsync everysec`, volume `redis_data` e limite de memória compartilhado de
256 MB com `noeviction`. Cache e filas usam bancos lógicos diferentes na mesma
instância. A persistência serve às filas; os dados de negócio continuam no
Postgres. Ao atingir o limite, novas escritas podem falhar. O healthcheck `PING`
verifica disponibilidade, mas não garante espaço para escritas.

### Cache L1/L2 e invalidação

Configure `REDIS_URL=redis://127.0.0.1:6379` (ou `redis://redis:6379` se a API
também estiver no Compose). A variável vazia desabilita o cache; `rediss://`
permite TLS. Aplique `bun run migrate` antes de iniciar a versão nova.
`CACHE_TTL_SECONDS` controla retenção, de 1 a 86400 segundos, padrão 60.

`CacheModule` fornece `CacheService` por injeção NestJS e encerra a conexão nos
hooks de shutdown. A L1 usa `lru-cache` para gerenciar TTL, descarte por uso
recente e limites: até 1000 entradas, 64 KiB por entrada e 64 MiB de payload
serializado no total. Hits não renovam a expiração original. A L2 usa Redis.
Cada hit da L1 confirma uma geração no Redis, sem transferir novamente o
payload. Esse custo de rede é intencional para evitar dados antigos entre
instâncias. Redis indisponível, timeout ou conteúdo inválido levam à leitura no
banco; a L1 não é usada de forma independente durante uma falha do Redis.

O primeiro consumidor é `GET /instituicoes/vinculadas`. O perfil do gestor e a
revisão dos vínculos/instituições visíveis são consultados no Postgres a cada
requisição. A projeção completa é carregada em lote no miss; não há consultas
por instituição. A migração adiciona uma revisão UUID técnica renovada por
trigger em qualquer `UPDATE`, inclusive SQL direto e seed. Mudanças de vínculo,
desativação e exclusão alteram o conjunto que forma a chave. A revisão e os
dados do loader são lidos no mesmo snapshot SQL; um resultado de revisão
diferente não é publicado na chave anterior. Rollback também desfaz a revisão.
Assim, a atualização não depende de um `DEL` no Redis depois do commit. Chaves
antigas deixam de ser utilizadas e expiram pelo TTL.

As gerações aleatórias do Redis e a publicação condicional atômica impedem um
loader anterior à invalidação, expiração ou perda dos metadados de repovoar o
cache. `invalidate(key)` existe para descarte administrativo e informa falhas;
não o use como única garantia de consistência de uma escrita de negócio.
Novos consumidores devem usar chaves com revisão da fonte de verdade, incluir
todo o contexto de isolamento/filtros e fornecer um decoder de validação. O
contrato de valores cacheados é JSON. Autenticação, transações de alocação,
financeiro e presença continuam consultando seu estado autoritativo.

O cache reduz a transferência da projeção e sua construção no caminho quente,
mas mantém uma consulta de revisão no banco e uma validação no Redis. Meça com
o volume real antes de ampliar o escopo. Ele não elimina as consultas de
autorização nem torna atômicas leituras concorrentes com novas alterações.

Testes opt-in com Redis real (banco Redis dedicado a testes recomendado):

```sh
CACHE_TEST_REDIS_URL=redis://127.0.0.1:6379 bun run test -- src/cache/cache.service.spec.ts src/instituicoes/instituicoes.service.spec.ts
```

### Filas BullMQ

O Compose usa uma instância Redis para cache e BullMQ. Configure
`REDIS_URL=redis://127.0.0.1:6379/0` para cache e
`QUEUE_REDIS_URL=redis://127.0.0.1:6379/1` para filas. Dentro de containers,
use o host `redis` em ambas. Os bancos lógicos separam as chaves, mas compartilham
memória, persistência e disponibilidade. Para isolar capacidade/falhas em um
ambiente maior, as duas URLs também aceitam instâncias diferentes.

O Redis usa AOF, volume `redis_data` e política `noeviction`. Não execute
`FLUSHALL` nem remova o volume para limpar cache; isso apagaria jobs. Qualquer
limpeza deve ser limitada às chaves de cache no banco 0, sem afetar o banco 1.

O Postgres continua sendo a fonte das entregas pendentes. A transação do fluxo
de negócio grava sua outbox; um reconciliador publica IDs no BullMQ depois do
commit. Conteúdo SMTP, endereço do destinatário e códigos de segurança não
entram nos jobs. O consumidor consulta a outbox, valida elegibilidade e usa
travas/reservas no banco para evitar processamento concorrente do mesmo item.
Reentrega de um item já concluído não envia novamente.

A garantia de entrega é pelo menos uma vez: uma queda após a aceitação SMTP
e antes da confirmação no Postgres pode repetir o e-mail. AOF a cada segundo
também pode perder escritas recentes em uma queda abrupta; a outbox permite
republicar trabalho pendente. Não há promessa de envio SMTP exatamente uma vez.

`QUEUE_RECONCILE_MS` configura o intervalo de reconciliação (padrão 5000 ms,
entre 1000 e 300000); `QUEUE_CONCURRENCY` limita os jobs simultâneos por instância
(padrão 5, entre 1 e 50). Cada ciclo percorre até 100 IDs de cada outbox com
cursor, retornando ao início após a última página. IDs determinísticos evitam
duplicar jobs que ainda estejam esperando ou ativos. Jobs concluídos e falhas
terminais são removidos; se a entrega continuar pendente, a reconciliação pode
recriá-los. O banco decide o prazo e o limite de tentativas de entrega.
`QUEUE_PREFIX` define o namespace BullMQ (padrão `alocca`); use um valor distinto
por ambiente quando compartilhar o mesmo Redis/DB. O valor aceita letras,
números, `_` e `-`, com até 100 caracteres.

BullMQ tenta novamente falhas de infraestrutura até três vezes, com backoff
exponencial a partir de um segundo. Falhas SMTP mantêm o reagendamento durável
existente: recuperação/segurança espera 30 segundos e só envia enquanto o token
for válido; notificações respeitam até cinco reservas/tentativas e backoff de
30 segundos até uma hora. Desativar a preferência de notificações também vale
para jobs já enfileirados; uma mensagem já em envio pode ser entregue.

Sem `QUEUE_REDIS_URL`, os timers legados continuam funcionando. Com a URL, só
BullMQ consome automaticamente as entregas: não há envio simultâneo por ambos
os mecanismos. `NODE_ENV=test` não inicia filas nem timers por padrão; testes
de integração podem habilitar a fila com `QUEUE_TEST_ENABLED=true`.

O produtor só cria conexão quando há trabalho e limita a espera por Redis.
O worker reconecta após falhas e o shutdown dá tempo para finalizar os jobs
ativos, com limite para não ficar preso em uma conexão indisponível. Uma parada
forçada continua sujeita à reentrega pela outbox e aos limites do SMTP.

Para executar os testes opt-in com BullMQ e Redis real, a partir de `backend`:

```sh
QUEUE_TEST_REDIS_URL=redis://127.0.0.1:6379/1 bun run test:e2e -- test/queue.e2e-spec.ts
```

Os testes usam um prefixo exclusivo e PGlite com as migrações reais. O pacote
`ioredis` é uma dependência explícita, necessária para as conexões do BullMQ.

Em produção, monitore falhas e atrasos dos jobs, tamanho/idade das outboxes,
memória e erros de AOF. `PING` não detecta falta de memória, falha de disco ou
atraso na entrega. Com `noeviction`, falta de memória rejeita novas escritas;
preserve a outbox e corrija a capacidade antes de retomar o fluxo.

Dentro de `backend`:

```sh
bun run migrate
bun run seed   # opcional: dados de demonstração
bun run dev
```

O seed cria um gestor, três hospitais e um médico
demo aprovado. Credenciais: gestor `gestor.demo@alocca.local` / `SenhaSegura123`
e médico `medico.demo@alocca.local` / `SenhaSegura123`.
O médico já tem plantões passados (com ponto e pagamento), um plantão em andamento
com check-in liberado, plantões futuros confirmados e candidaturas pendente e
rejeitada. As datas são relativas ao momento em que o seed roda; para recriar só
os dados demo com datas novas (ex.: antes de uma apresentação), use
`bun run seed --reset-demo`. O seed é bloqueado com `NODE_ENV=production`.

A migração reutiliza a tabela `usuarios`, converte os enums para os valores do MER
(`MEDICO`, `GESTOR`, `ADMIN`; `ATIVO`, `INATIVO`, `BLOQUEADO`) e normaliza e-mails.
Ela interrompe se houver usuários do antigo tipo `instituicao`, tipo/status nulos,
nomes maiores que 150 caracteres ou e-mails que conflitem após normalização.
Esses registros precisam ser revisados antes de aplicar a migração.

## Schemas do banco

As definições Drizzle ficam em `src/db/schemas`, com um arquivo por tabela:

- `usuarios.ts`: tabela de usuários e seus enums.
- `medicos.ts`: perfil médico, CRM/UF único e situação da validação.
- `tokens-recuperacao-senha.ts`: tokens vinculados ao usuário.
- `index.ts`: exporta os schemas e serve de entrada para o Drizzle Kit.

As referências entre tabelas importam o arquivo da tabela diretamente.
Os módulos da aplicação usam `src/db/schemas/index.ts`. Os schemas Zod de
entrada HTTP permanecem nos módulos de auth e usuários.

## Autenticação e usuários

O app usa `POST /auth/login/mobile` com `email`, `senha` e um `dispositivo_token` aleatório, tanto para médicos quanto para gestores. No primeiro acesso de cada conta no aparelho, retorna um desafio de PIN. Somente após validar esse PIN o servidor registra o hash do segredo como dispositivo confiável. Nos próximos logins, senha correta e prova do dispositivo permitem receber a sessão diretamente (`requer_2fa=false`). Sem a prova, o PIN continua obrigatório. Após autenticar, o app abre a área correspondente ao perfil retornado. As rotas mobile anteriores continuam disponíveis por compatibilidade; o login administrativo não muda.

O segredo do dispositivo é criptografado com Android Keystore e mantido ao sair da conta, sem IMEI ou identificadores de hardware. Reinstalar, limpar dados, perder a chave ou trocar/redefinir a senha exige novo PIN. A confiança é por conta: validar uma não libera outras contas no mesmo aparelho. O seed `--reset-demo` também remove a confiança do médico demo ao recriar essa conta.

- `POST /auth/register/medico`: cria usuário `MEDICO`/`ATIVO` e perfil médico na
  mesma transação. E-mail e CRM/UF são únicos, inclusive para registros excluídos.
- `POST /auth/login`: retorna `access_token`, `token_type`, `expires_in` e o perfil;
  atualiza `ultimo_login_at`.
- `GET /usuarios/me`: consulta o perfil do usuário autenticado.
- `PATCH /usuarios/me`: atualiza `nome`, `telefone`, `especialidade`, `crm` e/ou `uf_crm`.

Exemplo de cadastro:

```json
{
  "nome": "Dra. Maria Silva",
  "email": "maria@example.com",
  "senha": "SenhaSegura123",
  "telefone": "11999999999",
  "crm": "123456",
  "uf_crm": "SP",
  "especialidade": "Cardiologia"
}
```

No login, envie apenas `email` e `senha`. Nas rotas protegidas, use o header
`Authorization: Bearer <access_token>`. Senhas usam scrypt com salt aleatório;
`senha_hash` não é retornado. Contas inativas, bloqueadas ou excluídas não podem
entrar nem usar tokens já emitidos. Os endpoints de auth permitem até 10
requisições por minuto por IP por endpoint (contador em memória do processo).
Cinco senhas incorretas consecutivas para uma conta ativa resultam em bloqueio
persistido por 15 minutos (`tentativas_falhas`, `bloqueado_ate`); a quinta
resposta e as tentativas durante o bloqueio usam HTTP 429 e a mensagem MSG-03.
Um login bem-sucedido zera o contador. Credenciais inválidas permanecem com
mensagem genérica MSG-01.

O login atual não implementa o desafio 2FA. O formato e a expiração do
`challengeToken`, além do provedor para envio do PIN, seguem pendentes em D9 de
`docs/decisoes-pendentes.md`; implementar isso alteraria o contrato consumido
atualmente pelo app Android.

O cadastro público não aceita `tipo`, `status` ou IDs de terceiros. Gestores e
administradores já existentes podem autenticar; a criação desses perfis fica
para seus respectivos fluxos. O schema `tokens_recuperacao_senha` está preparado
para guardar **hashes** de tokens de uso único, mas os endpoints de recuperação
e o envio de e-mail ainda não estão implementados. Não há refresh token ou
logout no servidor; o access token expira no prazo configurado.

## Verificação

Para restringir uma rota por papel, importe `SecurityModule` no módulo e aplique
`@UseGuards(AuthGuard, PermissoesGuard)` junto de `@Permissoes('ADMIN')` ou
`@Permissoes('MEDICO', 'GESTOR')`. O decorator pode ser aplicado ao controller
ou ao método; a configuração do método substitui a do controller.
Sem decorator, o guard permite qualquer usuário autenticado. Sem autenticação,
retorna `401`; um papel não permitido retorna `403`. O papel é consultado no
banco pelo `AuthGuard` em cada requisição.

```sh
bun run build
bun run lint
bun run test
bun run test:e2e
```

Os testes e2e usam PostgreSQL embarcado via PGlite e banco isolado em memória,
executam as migrações reais e verificam cadastro, conflitos/rollback, login,
expiração, bloqueio, edição do perfil, limitação de tentativas e validação de médicos.

## Validação manual de médicos

O cadastro cria médicos com `status_validacao = PENDENTE`. A conta pode fazer
login e consultar/corrigir seu perfil enquanto aguarda análise. A validação
profissional é independente do status da conta (`ATIVO`, `INATIVO`, `BLOQUEADO`).
O administrador confere a identidade do solicitante, o nome, CRM e UF e a
situação da inscrição na [pesquisa oficial do CFM](https://portal.cfm.org.br/busca-medicos).
A consulta e a decisão são manuais; o backend não consulta uma API do CFM.

Rotas de administração, com `Authorization: Bearer <token-de-ADMIN>`:

- `GET /admin/medicos/pendentes`: lista os perfis aguardando análise.
- `PATCH /admin/medicos/:medicoId/validacao`: aprova ou rejeita um perfil pendente.

Exemplo de aprovação:

```json
{
  "nome": "Maria Silva",
  "crm": "123456",
  "uf_crm": "SP",
  "status_validacao": "APROVADO"
}
```

Exemplo de rejeição:

```json
{
  "nome": "Maria Silva",
  "crm": "123456",
  "uf_crm": "SP",
  "status_validacao": "REJEITADO",
  "motivo_rejeicao": "Nome do solicitante diverge do registro consultado"
}
```

Envie o nome e o CRM/UF que foram conferidos. Se o médico alterar esses dados antes da decisão,
a rota retorna `409` e exige nova conferência. A resposta inclui o perfil médico,
a situação, o responsável (`validado_por_usuario_id`) e a data (`validado_at`).
A rejeição exige um motivo, retornado também no próprio perfil do médico.
Uma decisão sobre um perfil já analisado retorna `409`. Apenas ADMIN pode listar
ou decidir; o administrador não pode analisar o próprio perfil.

Uma mudança efetiva de CRM ou UF em `PATCH /usuarios/me` volta o perfil para
`PENDENTE` e limpa os dados da análise anterior. Reenviar os mesmos valores ou
editar telefone/especialidade mantém a situação. CRM/UF duplicado retorna `409`
e desfaz toda a edição. A especialidade permanece declarada pelo médico; a
aprovação do registro não comprova o RQE.

Aplique a migração com `bun run migrate` antes de iniciar o backend atualizado.
A migração também coloca os médicos existentes em `PENDENTE`, sem aprová-los
automaticamente, e mantém a definição única de `usuarios`.

Para conceder o papel ADMIN a uma conta de confiança já cadastrada, conecte-se
ao banco como administrador e execute:

```sql
UPDATE usuarios SET tipo = 'ADMIN' WHERE email = 'email-da-conta@example.com';
```

A validação representa a conferência feita naquela data. Ainda não há módulos
de candidatura ou alocação; quando forem implementados, deverão exigir médico
com validação `APROVADO` para participar dos plantões.

### Ciclo de plantões (gestor)

- `PATCH /plantoes/:id`: campos parciais da publicação, exceto `instituicao_id`; corpo vazio e campos desconhecidos são rejeitados. Antes do início; RN27 protege datas e valor com candidaturas ativas. Especialidade e local também são protegidos.
- `POST /plantoes/:id/cancelar`: antes do início, encerra candidaturas e desativa alocações; bloqueado com pagamento realizado ou presença. Não realiza estorno.
- `POST /plantoes/:id/concluir`: transição explícita após o fim, preservando alocações, presença e financeiro.

Retorno: `{ message, plantao }`. Exige gestor ativo vinculado à instituição. Estados finais não aceitam novas mutações (409). Efeitos e notificações na outbox são atômicos. Políticas provisórias de cancelamento aguardando produto estão em `docs/decisoes-pendentes.md`.

Datas aceitam ISO 8601 com `Z` ou offset; formato legado sem sufixo é interpretado em UTC. As sessões PostgreSQL permanecem em UTC mesmo quando o banco usa outro fuso.

`bun run test:e2e` inclui testes reais de ciclo e fuso. Requer PostgreSQL com `CREATEDB` em `E2E_PG_ADMIN` (padrão `postgresql://postgres:postgres@127.0.0.1:5432/postgres`); cria e remove bancos temporários, sem reutilizar dados da aplicação.

### Consultas institucionais do gestor no Android

- `GET /gestor/medicos?limit=20&offset=0`: médicos com alocação não excluída nas instituições ativas administradas pelo gestor (RN14). Retorna `id`, `nome`, `crm`, `uf_crm`, `especialidade`, `status` da conta e `status_validacao`. Um profissional aparece uma única vez, mesmo com várias alocações. Candidaturas sem alocação não criam vínculo institucional.
- `GET /gestor/ponto?limit=20&offset=0`: eventos de entrada/saída dessas instituições, ordenados pelo timestamp do servidor e ID, com médico, plantão, instituição e indicador `com_localizacao`. Não retorna coordenadas nem afirma validação geográfica.

Ambas exigem JWT de `GESTOR` e perfil ativo; não são rotas administrativas globais. `limit` aceita 1–50 e `offset` não negativo. Sem vínculos ou registros, retornam `[]`. Instituições, plantões, alocações, médicos e usuários excluídos não aparecem. A tela é de consulta: o gestor não registra ponto em nome de médicos.
