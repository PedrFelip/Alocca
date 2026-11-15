# Integração Android — estado atual

## Entregue nesta alteração

As telas de médicos e registro de ponto do gestor consultam `/gestor/medicos` e `/gestor/ponto` com o token da sessão. Mostram dados reais, estado vazio, carregamento e erro, atualização manual e paginação. Sessão expirada encerra o login. As consultas respeitam as instituições vinculadas ao gestor; o vínculo do médico deriva exclusivamente de alocações (RN14).

A tela de médicos exibe nome, CRM/UF, especialidade, estado da conta e validação cadastral. A de ponto exibe médico, plantão, instituição, evento, horário do servidor no fuso de São Paulo e presença/ausência de localização. Não há edição nem registro de ponto em nome de terceiros.

As duas telas aplicam filtros no servidor e reiniciam a paginação ao aplicar ou limpar. Médicos: busca por nome/CRM/especialidade e filtros de especialidade, UF, conta, validação e instituição. Ponto: seleção de médico com busca paginada real, instituição, evento e período por dias locais (data final inclusiva na interface, convertida para limite exclusivo na API). Instituições vêm dos vínculos reais do gestor. Respostas antigas não substituem a consulta atual. O contrato e as limitações de paginação por offset estão em `backend/docs/contrato-consultas-gestor.md`.
## Indicadores da home do gestor

A home consome `GET /gestor/indicadores`, independente da paginação de plantões. O período é todo o histórico elegível das instituições ativas que o gestor administra, considerando os vínculos atuais e exclusões. Médicos são contados uma única vez por identidade, a partir de alocações; o histórico inclui alocações pagas e não representa vínculo contratual vigente. Vagas preenchidas contam alocações elegíveis, não a quantidade de plantões com status preenchido.

Os pagamentos são separados em pago, a pagar (pendente sem vencimento ou ainda no prazo) e em atraso (pendente com vencimento anterior ao instante de referência do banco). O fim do plantão não determina atraso. Valores chegam como strings decimais e são tratados como `BigDecimal` no Android. Escopo e exclusões detalhados em [`contrato-indicadores-gestor.md`](../backend/docs/contrato-indicadores-gestor.md).

## Pendências identificadas

- **Conta do gestor e instituição:** integrar edição de dados e contatos; o diálogo atual é somente informativo. Implementar o fluxo de cadastro de gestor/instituição e vínculo institucional, hoje dependente de preparação administrativa/seed; definir a validação de CNPJ.
- **Segurança:** Troca de senha autenticada integrada nas configurações de médico e gestor, com senha atual, RN05, confirmação e novo login após sucesso; troca/recuperação revoga tokens anteriores no backend. Recuperação de senha já chama a API, mas envio real requer SMTP configurado. Login por papel com PIN SMTP, refresh rotativo de 30 dias absolutos, logout remoto e biometria local opcional integrados. Ver `backend/docs/contrato-auth-app.md` para contrato e limitações de rede; validar biometria e SMTP real em ambiente controlado.
- **Notificações:** caixa de entrada paginada, leitura e preferências por destinatário estão integradas para médico e gestor, com carregamento, erro, retry e encerramento de sessão expirada. O backend entrega e-mail por SMTP quando habilitado no ambiente e pelo destinatário. Push e registro de dispositivo dependem de provedor configurado, sem entrega simulada. Contrato e operação: `backend/docs/contrato-notificacoes.md`. Preferências operacionais não controlam e-mails de autenticação/recuperação de senha.
- **Resumo do gestor:** filtros por período e comparativos temporais ficam fora desta entrega. O resumo usa todo o histórico elegível; não representa um fechamento contábil nem substitui a lista de pagamentos.
- **Médicos e ponto:** buscas/filtros têm contrato em `backend/docs/contrato-consultas-gestor.md`. Detalhes do profissional e eventual fluxo de contestação/ajuste permanecem pendentes; a tela de gestor não concede poderes de validação cadastral do administrador nem altera presença.
- **Regras de produto:** fechar compensações/estornos no cancelamento, validação cadastral institucional e contratos pendentes listados em `backend/docs/decisoes-pendentes.md`.
- **Operação:** validar o fluxo completo em dispositivo com contas reais (publicação → candidatura → aprovação → ponto → pagamento com comprovante), configurar HTTPS, SMTP e infraestrutura de produção. O modo HTTP/ADB do script é para desenvolvimento.

## Validação executada

Build e lint do backend; testes de presença/consultas com PGlite, incluindo autenticação, papel, isolamento institucional, paginação, exclusões e ausência de coordenadas; build e testes unitários Android, incluindo leitura das respostas novas.

Notificações (14/11/2026): backend build/lint, 33 testes unitários e 243 testes de integração passaram (12 casos existentes ignorados pela suíte). Android `assembleDebug` e 37 testes unitários passaram. A migração foi exercitada nos bancos de teste, incluindo o ciclo com PostgreSQL; não foi aplicada ao banco de uso compartilhado. Os testes de envio substituem o adaptador SMTP e não enviam mensagens a terceiros. Ainda falta homologação com SMTP autorizado e teste de concorrência de duas instâncias do worker contra PostgreSQL real; o teste atual cobre chamadas simultâneas na mesma instância. SMTP oferece entrega pelo menos uma vez: queda após aceitação e antes do commit pode duplicar a mensagem.
Nesta frente: 33 testes unitários backend; suíte de integração geral com 242 aprovados e 12 ignorados na execução inicial; depois da conclusão do backend, 16 testes de presença/consultas aprovados com `TZ=America/Sao_Paulo`, build e lint aprovados. Android: 36 testes unitários, `assembleDebug` e `lintDebug` offline aprovados na conferência final, usando apenas `ANDROID_HOME` no processo. Uma execução anterior apresentou falha intermitente no teste de dispatcher de `PlantoesRepositoryTest`, fora desta alteração; a conferência completa posterior passou. Nenhum app foi instalado e não houve validação visual/em dispositivo. Testes de Postgres real ignorados por indisponibilidade continuam sendo limitação da validação local.

## Validação desta frente de segurança

Backend: build, lint, 33 unitários e suíte e2e serial (18 arquivos); teste de replay com conexões PostgreSQL independentes. Android: 41 testes unitários e assembleDebug. Nenhum app instalado no celular compartilhado. Migrações de sessão precisam ser aplicadas antes do backend atualizado. Biometria física, SMTP/HTTPS e percurso completo em dispositivo ainda pendentes.
## Validação dos indicadores

Backend: build e lint, 33 testes unitários e 248 testes de integração aprovados (`bun run test:e2e --maxWorkers=2`); 12 casos dependentes de serviços externos pulados. Os nove casos novos verificam isolamento, deduplicação, exclusões, revogação, totais decimais e vencimento inclusive exatamente no instante da consulta.

Android: `build`, `:app:assembleDebug` e `:app:testDebugUnitTest` aprovados com SDK/JDK existentes (37 testes, zero falhas). Testes dos indicadores cobrem rota/método/token, leitura de decimais sem perda, vazio, resposta inválida, erros de conexão e HTTP 401/403/500. Pendente: ensaio visual/integrado da home com conta real e backend em execução, incluindo acessibilidade. Não foi instalado aplicativo no celular compartilhado.
