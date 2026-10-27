# Decisões Pendentes — Alocca Plantões (back-end)

Dúvidas em aberto que travam ou mudam implementação. Fonte oficial: `project-context.md`.
Marque `[x]` e mova para o spec quando decidir.

## Modelo
- [ ] **D1 — Tipo das coordenadas GPS:** `Decimal(10,8)` (precisão fixa, versão AGENTS) ou `Float` (versão guide, atual no spec)? E o campo de distância: `distanciaMetros` ou `distanciaLocal`? Impacto: migration de `registros_presenca`.
- [ ] **D2 — Herança usuarios → medico/gestor:** preferência é extensão (joined-table: `medicos.usuario_id → usuarios.id`), mas está como "ponto a definir". Alternativa: single-table com `tipo_usuario`. Impacto: todas as migrations de auth + FKs de `candidatura`/`alocacao`.
- [x] **D3 — Resolvido:** `plantao.gestor_criador_id` mantido, com FK para `usuarios.id` (spec: `Plantao.gestorCriadorId`), e não para `gestores.id`.
- [ ] **D4 — `createdAt/updatedAt` em plantao/instituicao:** mantidos do guide; o AGENTS não tinha. Manter padrão em todas as tabelas? Impacto: migrations.
- [ ] **D13 — Colunas extras do PR0 (fora do spec):** `plantoes` mantém `titulo`, `descricao`, `permite_candidatura`, `exige_checkin` e `permite_geolocalizacao`; `pagamentos` mantém `vencimento_em`/`observacoes`; `candidaturas` mantém `mensagem_medico`/`observacao_gestor`/`analisado_por_gestor_id`/`analisado_at`. Alinhar/validar com a frente de gestão de plantões. Impacto: colunas.
- [ ] **D14 — `pagamentos.urlComprovantePdf`:** o spec cita a coluna, mas o download de comprovante ficou fora do PR0. Definir se vira coluna ou tabela de arquivos (relaciona com D11). Impacto: UC08/UC12.
- [ ] **D15 — Tabelas fora do PR0:** `notificacoes` criada (outbox UC11; entrega ainda em D10). `tokens_2fa` (D9) ainda não existe. Impacto: UC02.
- [ ] **D16 — Recandidatura:** `UNIQUE(plantao_id, medico_id)` em candidaturas impede nova candidatura após `REJEITADA` (spec). Decidir se rejeitado pode voltar a candidatar-se (índice parcial). Impacto: UC05.

## Regras e fluxos
- [ ] **D17 — Completude de perfil na candidatura (RN17):** porção "Sem Especialidade, não aplica para vagas específicas" implementada no UC05 (médico sem `especialidade` recebe 403). Pendente: limiar de `taxaCompletude` exigido e se a especialidade declarada precisa casar com a `especialidade` do plantão. Impacto: filtro de candidatos/publicação.
- [ ] **D5 — Convites diretos (RN31):** regra de expiração existe, mas não há nenhum endpoint/UC de convite no spec. Vai ter convite direto no MVP ou a RN31 cai? Impacto: escopo do MVP.
- [ ] **D6 — Numeração das RNs:** unifiquei pela base do AGENTS + RN31 por inferência (item 15). Validar se algum número conflita com doc externa (mobile/Kotlin).
- [ ] **D7 — Nomenclatura do financeiro:** `totalRecebido`, `totalAReceber`, `totalPendente` (nomenclatura flexível por ora). Confirmar com o app o que ele espera. Impacto: contrato do UC08.
- [ ] **D8 — Validação de CNPJ (RN30):** "CNPJ válido e ativo + ramo de saúde" — como? API da Receita na hora do vínculo, validação só de formato + dígito, ou manual? Impacto: UC de vínculo de instituição (ainda sem endpoint no spec).
- [ ] **D9 — Fluxo 2FA completo:** não implementado no contrato atual do app Android. Permanecem pendentes o formato/expiração do `challengeToken`, expiração do refresh token (RNF05) e quem envia o e-mail do PIN (provedor SMTP?). Não adicionar 2FA até definir e alinhar o contrato de UC02/UC03 com o app.
- [ ] **D10 — Notificações da cascata (UC11):** UC11 grava os eventos em outbox (`notificacoes`) na MESMA transação da aprovação (RN21). Pendente: provedor de entrega (Firebase, SMTP próprio, worker de consumo do outbox) e colunas de canal/retry. Impacto: UC02/UC11.

## Infra
- [ ] **D11 — SeaweedFS:** bucket, URL pública vs assinada, quem serve o download do comprovante (back-end proxy ou URL direta)? Impacto: UC08/UC12.
- [ ] **D12 — Cadastro de gestor e de instituição:** não há UC para criar conta de gestor nem vincular instituição (só `GET /instituicoes/vinculadas`). Endpoints novos ou seed manual? Impacto: UC10 trava sem isso.
