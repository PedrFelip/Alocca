# Integração Android — estado atual

## Entregue nesta alteração

As telas de médicos e registro de ponto do gestor consultam `/gestor/medicos` e `/gestor/ponto` com o token da sessão. Mostram dados reais, estado vazio, carregamento e erro, atualização manual e paginação. Sessão expirada encerra o login. As consultas respeitam as instituições vinculadas ao gestor; o vínculo do médico deriva exclusivamente de alocações (RN14).

A tela de médicos exibe nome, CRM/UF, especialidade, estado da conta e validação cadastral. A de ponto exibe médico, plantão, instituição, evento, horário do servidor no fuso do dispositivo e presença/ausência de localização. Não há edição nem registro de ponto em nome de terceiros.

As duas telas aplicam filtros no servidor e reiniciam a paginação ao aplicar ou limpar. Médicos: busca por nome/CRM/especialidade e filtros de especialidade, UF, conta, validação e instituição. Ponto: seleção de médico com busca paginada real, instituição, evento e período por dias locais (data final inclusiva na interface, convertida para limite exclusivo na API). Instituições vêm dos vínculos reais do gestor. Respostas antigas não substituem a consulta atual. O contrato e as limitações de paginação por offset estão em `backend/docs/contrato-consultas-gestor.md`.

## Pendências identificadas

- **Conta do gestor e instituição:** integrar edição de dados e contatos; o diálogo atual é somente informativo. Implementar o fluxo de cadastro de gestor/instituição e vínculo institucional, hoje dependente de preparação administrativa/seed; definir a validação de CNPJ.
- **Segurança:** implementar troca de senha autenticada nas configurações. Recuperação de senha já chama a API, mas envio real requer SMTP configurado. Definir e implementar o contrato de 2FA/PIN e renovação de sessão; não adicionar autenticação fictícia.
- **Notificações:** entregar os eventos da outbox por push/e-mail, registrar dispositivo e implementar listagem/leitura e preferências no aplicativo. A interface atual informa indisponibilidade.
- **Resumo do gestor:** indicadores agregados de médicos, vagas e financeiro foram removidos por serem fictícios. Para retornarem, precisam de consultas agregadas no backend; a home hoje mostra uma página reduzida dos plantões reais.
- **Médicos e ponto:** buscas/filtros têm contrato em `backend/docs/contrato-consultas-gestor.md`. Detalhes do profissional e eventual fluxo de contestação/ajuste permanecem pendentes; a tela de gestor não concede poderes de validação cadastral do administrador nem altera presença.
- **Regras de produto:** fechar compensações/estornos no cancelamento, validação cadastral institucional e contratos pendentes listados em `backend/docs/decisoes-pendentes.md`.
- **Operação:** validar o fluxo completo em dispositivo com contas reais (publicação → candidatura → aprovação → ponto → pagamento com comprovante), configurar HTTPS, SMTP e infraestrutura de produção. O modo HTTP/ADB do script é para desenvolvimento.

## Validação executada

Build e lint do backend; testes de presença/consultas com PGlite, incluindo autenticação, papel, isolamento institucional, paginação, exclusões e ausência de coordenadas; build e testes unitários Android, incluindo leitura das respostas novas.

Nesta frente: 33 testes unitários backend; suíte de integração geral com 242 aprovados e 12 ignorados na execução inicial; depois da conclusão do backend, 16 testes de presença/consultas aprovados com `TZ=America/Sao_Paulo`, build e lint aprovados. Android: 36 testes unitários, `assembleDebug` e `lintDebug` offline aprovados na conferência final, usando apenas `ANDROID_HOME` no processo. Uma execução anterior apresentou falha intermitente no teste de dispatcher de `PlantoesRepositoryTest`, fora desta alteração; a conferência completa posterior passou. Nenhum app foi instalado e não houve validação visual/em dispositivo. Testes de Postgres real ignorados por indisponibilidade continuam sendo limitação da validação local.
