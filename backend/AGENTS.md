# AGENTS.md — Alocca Plantões (back-end)

Spec oficial: `docs/project-context.md` (RN, MSG, UC01–UC12). Em caso de conflito, vale o spec — não este arquivo.

## Stack
NestJS 12 + Bun + TypeScript, Drizzle ORM + Postgres (`postgres-js`), Zod, Vitest + Supertest, oxlint/oxfmt.

## Comandos (`backend/`)
- `bun install` · `bun run dev` (watch) · `bun run build` / `start:prod`
- `bun run generate` / `migrate` / `studio` (drizzle-kit)
- `bun run test` · `test:e2e` · `test:cov` · `bun run lint` · `bun run fmt`

## Estrutura
`src/main.ts` · `src/app.module.ts` (ConfigModule global + DatabaseModule) · `src/config/env.ts` (valida `NODE_ENV, PORT, DATABASE_URL`) · `src/db/` (provider `DRIZZLE_DB`, `schema.ts`, `usuarios/`) · `test/` (e2e).

## Regras de ouro
1. Camadas: controller só DTO/HTTP → service/use-case com a RN → repository SQL parametrizado → entity/drizzle schema.
2. UC11 (alocação) sempre em transação atômica; UC05 checa double-booking antes de persistir.
3. Senha só com hash forte (bcrypt/Argon2), nunca plain. Rate limit no login, recuperação com resposta genérica.
4. Check-in pontual por toque explícito, sem tracking em background; GPS negado = `latitude/longitude = null`, valida só pelo timestamp do servidor (LGPD).
5. Financeiro sem gateway no MVP (`Pendente` → `Pago` só com comprovante PDF/JPG/PNG, nome de arquivo com UUID).
6. Nunca hardcodar segredo (`.env`), responder erros no padrão MSG-XX do spec, logar ações críticas (login falho, alocação, baixa).
7. Ordem de entrega: migrações → auth (UC01–UC04) → instituições/plantões (UC10) → feed/alocação (UC05+UC11) → presença/perfil/financeiro (UC06–UC09, UC12) → testes (double-booking, transação UC11).

## Antes de codar
Leia `docs/project-context.md` (seções RN/UC/MSG da feature) — ele é a fonte oficial. Dúvidas em aberto estão em `docs/decisoes-pendentes.md`. Não invente número de RN, tempo de expiração ou modelagem.
