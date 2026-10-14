# Decisões Pendentes — Alocca Plantões (back-end)

Dúvidas em aberto que travam ou mudam implementação. Fonte oficial: `project-context.md`.
Marque `[x]` e mova para o spec quando decidir.

## Modelo
- [ ] **D1 — Tipo das coordenadas GPS:** `Decimal(10,8)` (precisão fixa, versão AGENTS) ou `Float` (versão guide, atual no spec)? E o campo de distância: `distanciaMetros` ou `distanciaLocal`? Impacto: migration de `registros_presenca`.
- [ ] **D2 — Herança usuarios → medico/gestor:** preferência é extensão (joined-table: `medicos.usuario_id → usuarios.id`), mas está como "ponto a definir". Alternativa: single-table com `tipo_usuario`. Impacto: todas as migrations de auth + FKs de `candidatura`/`alocacao`.
- [ ] **D3 — `gestorCriadorId` em plantao:** mantido do guide original (quem publicou a vaga), mas nunca foi decidido. Vale? Impacto: coluna + FK extra.
- [ ] **D4 — `createdAt/updatedAt` em plantao/instituicao:** mantidos do guide; o AGENTS não tinha. Manter padrão em todas as tabelas? Impacto: migrations.

## Regras e fluxos
- [ ] **D5 — Convites diretos (RN31):** regra de expiração existe, mas não há nenhum endpoint/UC de convite no spec. Vai ter convite direto no MVP ou a RN31 cai? Impacto: escopo do MVP.
- [ ] **D6 — Numeração das RNs:** unifiquei pela base do AGENTS + RN31 por inferência (item 15). Validar se algum número conflita com doc externa (mobile/Kotlin).
- [ ] **D7 — Nomenclatura do financeiro:** `totalRecebido`, `totalAReceber`, `totalPendente` (nomenclatura flexível por ora). Confirmar com o app o que ele espera. Impacto: contrato do UC08.
- [ ] **D8 — Validação de CNPJ (RN30):** "CNPJ válido e ativo + ramo de saúde" — como? API da Receita na hora do vínculo, validação só de formato + dígito, ou manual? Impacto: UC de vínculo de instituição (ainda sem endpoint no spec).
- [ ] **D9 — Fluxo 2FA completo:** formato/expiração do `challengeToken`, expiração do refresh token (RNF05), quem envia o e-mail do PIN (provedor SMTP?). Impacto: UC02/UC03.
- [ ] **D10 — Notificações da cascata (UC11):** push/e-mail para aprovado + rejeitados — qual provedor (Firebase, SMTP próprio, fila interna)? Enfileirar onde (tabela `notificacoes`, BullMQ, outro)? Impacto: UC11.

## Infra
- [ ] **D11 — SeaweedFS:** bucket, URL pública vs assinada, quem serve o download do comprovante (back-end proxy ou URL direta)? Impacto: UC08/UC12.
- [ ] **D12 — Cadastro de gestor e de instituição:** não há UC para criar conta de gestor nem vincular instituição (só `GET /instituicoes/vinculadas`). Endpoints novos ou seed manual? Impacto: UC10 trava sem isso.
