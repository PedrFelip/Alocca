# Integração Android — estado atual

## Entregue nesta alteração

As telas de médicos e registro de ponto do gestor consultam `/gestor/medicos` e `/gestor/ponto` com o token da sessão. Mostram dados reais, estado vazio, carregamento e erro, atualização manual e paginação. Sessão expirada encerra o login. As consultas respeitam as instituições vinculadas ao gestor; o vínculo do médico deriva exclusivamente de alocações (RN14).

A tela de médicos exibe nome, CRM/UF, especialidade, estado da conta e validação cadastral. A de ponto exibe médico, plantão, instituição, evento, horário do servidor no fuso do dispositivo e presença/ausência de localização. Não há edição nem registro de ponto em nome de terceiros.

## Pendências identificadas

- **Conta do gestor e instituição:** integrar edição de dados e contatos; o diálogo atual é somente informativo. Implementar o fluxo de cadastro de gestor/instituição e vínculo institucional, hoje dependente de preparação administrativa/seed; definir a validação de CNPJ.
- **Segurança:** implementar troca de senha autenticada nas configurações. Recuperação de senha já chama a API, mas envio real requer SMTP configurado. Definir e implementar o contrato de 2FA/PIN e renovação de sessão; não adicionar autenticação fictícia.
- **Notificações:** caixa de entrada paginada, leitura e preferências por destinatário estão integradas para médico e gestor, com carregamento, erro, retry e encerramento de sessão expirada. O backend entrega e-mail por SMTP quando habilitado no ambiente e pelo destinatário. Push e registro de dispositivo dependem de provedor configurado, sem entrega simulada. Contrato e operação: `backend/docs/contrato-notificacoes.md`. Preferências operacionais não controlam e-mails de autenticação/recuperação de senha.
- **Resumo do gestor:** indicadores agregados de médicos, vagas e financeiro foram removidos por serem fictícios. Para retornarem, precisam de consultas agregadas no backend; a home hoje mostra uma página reduzida dos plantões reais.
- **Médicos e ponto:** busca/filtros no servidor, detalhes do profissional e eventual fluxo de contestação/ajuste de ponto precisam de contrato próprio. A consulta paginada está integrada; a tela de gestor não concede poderes de validação cadastral do administrador.
- **Regras de produto:** fechar compensações/estornos no cancelamento, validação cadastral institucional e contratos pendentes listados em `backend/docs/decisoes-pendentes.md`.
- **Operação:** validar o fluxo completo em dispositivo com contas reais (publicação → candidatura → aprovação → ponto → pagamento com comprovante), configurar HTTPS, SMTP e infraestrutura de produção. O modo HTTP/ADB do script é para desenvolvimento.

## Validação executada

Build e lint do backend; testes de presença/consultas com PGlite, incluindo autenticação, papel, isolamento institucional, paginação, exclusões e ausência de coordenadas; build e testes unitários Android, incluindo leitura das respostas novas.

Notificações (14/11/2026): backend build/lint, 33 testes unitários e 243 testes de integração passaram (12 casos existentes ignorados pela suíte). Android `assembleDebug` e 37 testes unitários passaram. A migração foi exercitada nos bancos de teste, incluindo o ciclo com PostgreSQL; não foi aplicada ao banco de uso compartilhado. Os testes de envio substituem o adaptador SMTP e não enviam mensagens a terceiros. Ainda falta homologação com SMTP autorizado e teste de concorrência de duas instâncias do worker contra PostgreSQL real; o teste atual cobre chamadas simultâneas na mesma instância. SMTP oferece entrega pelo menos uma vez: queda após aceitação e antes do commit pode duplicar a mensagem.
