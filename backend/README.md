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
`ADMIN_WEB_ORIGIN` define a origem permitida pelo CORS para o painel Svelte
(padrão: `http://localhost:5173`). Configure a origem exata do painel em produção.

Na raiz do projeto, inicie o banco local com `docker compose up -d --wait db`.
A conexão padrão do `.env.example` corresponde ao serviço do Compose.

Dentro de `backend`:

```sh
bun run migrate
bun run dev
```

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
  "senha": "senha-segura-123",
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
