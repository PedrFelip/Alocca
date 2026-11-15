# Contrato de Auth implementado — app Kotlin

> Fonte oficial: `project-context.md` (UC01–UC12). Em conflito de rota, casing
> ou mensagem, **vale o spec**. Este arquivo só descreve o que o backend
> entrega hoje (`POST /auth/register/medico`, `POST /auth/login`, snake_case,
> sem `/api/v1`) até o código ser alinhado (D18). Não substitui o spec.
>
> **Convenções atuais do código:** snake_case no corpo, sem prefixo `/api/v1`,
> erros no shape do NestJS (`{ message, error?, statusCode, errors? }`).

## Mensagens oficiais

| Código | Mensagem | HTTP |
| ------ | -------- | ---- |
| MSG-01 | `E-mail, CPF, CRM ou senha incorretos.` | 401 |
| MSG-02 | `Este dado (E-mail/CPF/CRM) já pertence a uma conta ativa.` | 409 |
| MSG-03 | `Conta bloqueada temporariamente. Tente novamente em 15 minutos.` | 429 |
| MSG-07 | `Cadastro realizado com sucesso!` (spec). O 201 atual devolve o objeto do usuário, sem a frase — gap pendente. | 201 |

## `POST /auth/register/medico` — implementado (spec UC01: `POST /api/v1/auth/medicos/registro`, `ufCrm`)

```json
{
  "nome": "Dr. Lucas Silva", // 2–150 caracteres, trim
  "cpf": "12345678901", // 11 dígitos; aceita máscara (higiene RN04); RN02 valida o dígito
  "crm": "123456", // apenas números
  "uf_crm": "DF", // 27 UFs; aceita minúsculas (normalizado para maiúsculas)
  "especialidade": "Clínica Médica", // opcional, 1–100
  "email": "lucas.silva@medico.com", // trim + lowercase, RN01
  "senha": "SenhaSegura123" // RN05: ≥8, maiúscula, minúscula e número
}
```

- `201` → objeto do usuário (`id, nome, cpf, email, telefone, tipo,
status, …`, **sem `senha_hash`**) + `medico`:
  `{ id, usuario_id, crm, uf_crm, especialidade, status_validacao: "PENDENTE", … }`.
  `status_validacao` nasce sempre `PENDENTE` — validação manual pelo admin.
- `400` → `{ message, errors: { formErrors, fieldErrors }, statusCode }` —
  validar no cliente antes (RN05, CPF, UF) e mostrar `fieldErrors` por campo.
- `409` (MSG-02) → e-mail, CPF ou `crm + uf_crm` já usado por conta ativa.
- `429` → throttle do endpoint.

## `POST /auth/login` — login (não autenticado, 10 req/min)

```json
{ "email": "lucas.silva@medico.com", "senha": "SenhaSegura123" }
```

- `200`: `{ access_token, token_type: "Bearer", expires_in: 900, usuario: { …, medico|null } }`.
  JWT HS256 de 15 min (env `JWT_EXPIRES`); o guard revalida `status = ATIVO` e a versão de sessão no banco a cada request. Troca ou recuperação de senha invalida todos os tokens anteriores, inclusive legados sem versão.
- `401` (MSG-01) → mesma resposta para senha errada e e-mail inexistente (anti-enumeração).
- `429` (MSG-03) → 5 falhas consecutivas (RN08) ou throttle. RN08: bloqueio de
  15 min, `tentativas_falhas` reseta no sucesso e na expiração do bloqueio.
- Login aceita **somente e-mail**; login por CPF/CRM (RN07) fica fora do MVP.

## `POST /auth/recuperar-senha` — pedir código (UC04, não autenticado, 5 req/min)

```json
{ "email": "lucas.silva@medico.com" }
```

- `200` sempre (MSG-05), exista o e-mail ou não (RN12). Se existir e a conta
  estiver ATIVA, manda por e-mail um código de uso único que vale 15 min (RN11).
  O código tem 8 caracteres (letras maiúsculas e números, sem 0/O/1/I).
  Pedir de novo invalida o código anterior. O banco guarda só o hash (sha256).
- No máximo 3 e-mails por conta a cada 15 min (além do limite por IP). Passou
  disso, a resposta é a mesma, só não envia.
- O e-mail sai por SMTP (`SMTP_*` no `.env`, ver `.env.example`). Sem
  `SMTP_HOST` o back responde normal e só não envia.

## `POST /auth/redefinir-senha` — trocar a senha (UC04, não autenticado, 5 req/min)

```json
{ "token": "K7MP2QXA", "nova_senha": "NovaSenhaForte123" }
```

- O código pode vir em minúsculo e com espaço nas pontas, o back normaliza.

- `200` (MSG-08) → senha trocada; zera o bloqueio de login (RN08).
- `400` (MSG-06) → código inválido, vencido ou já usado.
- `400` → `nova_senha` fora da RN05 (mesma regra do cadastro); não gasta o código.
- Spec usa `novaSenha`; aqui é `nova_senha` (snake_case, D18).

## `GET /usuarios/me` — sessão/restauração (Bearer)

- `200`: `{ …usuario, medico: { … } | null }` (sem `senha_hash`).
- `401` → token ausente, inválido, expirado, usuário BLOQUEADO/INATIVO ou deletado
  → o app deve limpar o token local e voltar ao login.

## `PATCH /usuarios/me` — perfil (Bearer)

- Corpo parcial `strictObject`: `nome`, `telefone`, `especialidade`, `crm`, `uf_crm`.
- Mudar `crm`/`uf_crm` volta `status_validacao` para `PENDENTE` (revalidação manual).
- Duplicidade de CRM/UF → `409` (MSG-02). `400` em campos de status/tipo.

## Padrões para o app

- 401 → limpar token e voltar ao login. **403 não encerra a sessão**: em várias
  rotas ele é regra de negócio (ex.: candidatura sem especialidade compatível) e
  deve mostrar a mensagem do servidor; 409 → MSG-02; 429 → MSG-03;
  exceção de rede → mensagem de conexão distinta das anteriores.
- Senha do cadastro deve espelhar RN05 no cliente (mesma exigência do backend).


## `POST /auth/alterar-senha` — configurações (Bearer)

Corpo estrito: `{"senha_atual":"SenhaAtual123","nova_senha":"NovaSenha123"}`.
`nova_senha` segue RN05, com máximo de 128 caracteres; senha atual não sofre trim.

- `200`: `{"message":"Senha atualizada com sucesso!"}` (MSG-08). Android apaga
  o token local e pede novo login. Todos os access tokens anteriores deixam de valer.
- `400`: corpo inválido ou senha atual incorreta (MSG-01); senha incorreta consome tentativa por conta.
- `401`: sessão inválida; Android encerra sessão.
- `429`: até 5 requisições/min por IP e 5 tentativas/conta por minuto, com contador
  separado do bloqueio RN08. Não bloqueia o login da conta.

Senha, incremento de `versao_sessao` e invalidação de códigos de recuperação pendentes
são gravados na mesma transação, com trava de usuário. Recuperação bem-sucedida
aplica a mesma revogação. JWT sem `versao_sessao` equivale à versão zero, preservando
sessões legadas até a primeira troca/recuperação. Campos internos não entram no perfil.
Aplicar a migração `20261114231753_pretty_cardiac` antes de iniciar o backend atualizado.

## 2FA, refresh e logout — mobile (D9)

Todas as rotas retornam 200 no sucesso e usam snake_case, sem `/api/v1`.

- `POST /auth/login/medico` ou `/auth/login/gestor`: `{email,senha}` →
  `{challenge_token,requer_2fa:true,expires_in:300}`. Nenhuma sessão antes do PIN.
- `POST /auth/2fa/solicitar-pin`: `{challenge_token}` → `{message}`. PIN numérico
  de 6 dígitos, 5 minutos; reenvio substitui PIN anterior. Até 3 envios/conta/15 min
  e 5 requisições/IP/min. SMTP ausente/falho retorna 503, sem simular entrega.
- `POST /auth/2fa/validar-pin`: `{challenge_token,pin_code}` →
  `{access_token,token_type:"Bearer",expires_in,refresh_token,refresh_expires_in,usuario}`.
  Challenge é de uso único, expira em 5 minutos e fica inválido após 5 erros.
- `POST /auth/refresh`: `{refresh_token}` → mesmo shape de sessão. Refresh gira
  atomicamente; prazo absoluto da família é 30 dias, sem extensão. Replay revoga
  a família inteira. Guard consulta sessão ativa em cada uso do access mobile.
- `POST /auth/logout`: `{refresh_token}` → `{message}`, idempotente; revoga família
  atual inclusive access. Alteração/recuperação revoga todas as famílias e desafios.

Challenge/refresh são aleatórios de 256 bits e só persistem como SHA-256; PIN é
HMAC-SHA256 com segredo do servidor. PIN é enviado diretamente por SMTP dentro da
transação (não usa outbox de recuperação); falha de commit após envio pode exigir
novo pedido. Respostas inválidas/expiradas usam 401; limites usam 429.

Android usa as rotas mobile por papel, tela PIN e restauração via perfil. Guarda
par e expirações atomicamente cifrados AES-GCM/Keystore, com backup desativado.
Renovação é serializada e cada operação autenticada repete no máximo uma vez,
inclusive upload/download. Rede/5xx preserva credenciais; refresh 400/401 encerra
sessão. Logout limpa local imediatamente e tenta revogação remota em background:
sem rede não garante revogação remota. Se resposta de rotação se perder após commit,
um retry pode disparar proteção de replay e exigir login; não existe janela de graça.

Biometria é opcional e local: CryptoObject com chave Keystore autenticada decifra
marcador antes de restaurar sessão, sem declaração biométrica ao servidor. Hardware
indisponível/chave invalidada permite voltar ao login PIN. Validação física pendente.
Login legado `/auth/login` aceita apenas ADMIN em produção por padrão. `LOGIN_LEGADO_MOBILE=true` reabilita temporariamente o acesso sem PIN para MEDICO e GESTOR; `false` bloqueia também fora de produção. A data de retirada dessa exceção depende de decisão de produto. Aplicar também migração `20261114232625_peaceful_wolfpack`.
