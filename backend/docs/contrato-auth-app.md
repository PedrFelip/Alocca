# Contrato de Auth para o App (Kotlin) — vivo em `main`

> Este arquivo descreve o contrato **implementado e em produção** dos endpoints de
> autenticação, conforme resolveu a issue #27. O spec teórico completo é
> `project-context.md` (UC01–UC12); quando os dois divergirem em rota/formato,
> vale este arquivo até o spec ser alinhado.
>
> **Convenções:** snake_case no corpo, sem prefixo `/api/v1`, erros no shape do
> NestJS (`{ message, error?, statusCode, errors? }`), mensagens no padrão MSG-XX.

## Mensagens oficiais

| Código | Mensagem exata                                                       | HTTP |
| ------ | -------------------------------------------------------------------- | ---- |
| MSG-01 | `E-mail, CPF, CRM ou senha incorretos.`                              | 401  |
| MSG-02 | `Este dado (E-mail/CPF/CRM) já pertence a uma conta ativa.`          | 409  |
| MSG-03 | `Conta bloqueada temporariamente. Tente novamente em 15 minutos.`    | 429  |
| MSG-07 | Cadastro bem-sucedido (HTTP 201; o corpo não ecoa a frase da MSG-07) | 201  |

## `POST /auth/register/medico` — UC01 (não autenticado, 10 req/min)

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
  JWT HS256 de 15 min (env `JWT_EXPIRES`); o guard revalida `status = ATIVO` no banco a cada request.
- `401` (MSG-01) → mesma resposta para senha errada e e-mail inexistente (anti-enumeração).
- `429` (MSG-03) → 5 falhas consecutivas (RN08) ou throttle. RN08: bloqueio de
  15 min, `tentativas_falhas` reseta no sucesso e na expiração do bloqueio.
- Login aceita **somente e-mail**; login por CPF/CRM (RN07) fica fora do MVP.

## `GET /usuarios/me` — sessão/restauração (Bearer)

- `200`: `{ …usuario, medico: { … } | null }` (sem `senha_hash`).
- `401` → token ausente, inválido, expirado, usuário BLOQUEADO/INATIVO ou deletado
  → o app deve limpar o token local e voltar ao login.

## `PATCH /usuarios/me` — perfil (Bearer)

- Corpo parcial `strictObject`: `nome`, `telefone`, `especialidade`, `crm`, `uf_crm`.
- Mudar `crm`/`uf_crm` volta `status_validacao` para `PENDENTE` (revalidação manual).
- Duplicidade de CRM/UF → `409` (MSG-02). `400` em campos de status/tipo.

## Padrões para o app

- 401/403 → limpar token e voltar ao login; 409 → MSG-02; 429 → MSG-03;
  exceção de rede → mensagem de conexão distinta das anteriores.
- Senha do cadastro deve espelhar RN05 no cliente (mesma exigência do backend).
