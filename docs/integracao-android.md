# Integração Android — estado atual

## Entregue nesta alteração

As telas de médicos e registro de ponto do gestor consultam `/gestor/medicos` e `/gestor/ponto` com o token da sessão. Mostram dados reais, estado vazio, carregamento e erro, atualização manual e paginação. Sessão expirada encerra o login. As consultas respeitam as instituições vinculadas ao gestor; o vínculo do médico deriva exclusivamente de alocações (RN14).

A tela de médicos exibe nome, CRM/UF, especialidade, estado da conta e validação cadastral. A de ponto exibe médico, plantão, instituição, evento, horário do servidor no fuso do dispositivo e presença/ausência de localização. Não há edição nem registro de ponto em nome de terceiros.

## Pendências identificadas

- **Conta do gestor e instituição:** integrar edição de dados e contatos; o diálogo atual é somente informativo. Implementar o fluxo de cadastro de gestor/instituição e vínculo institucional, hoje dependente de preparação administrativa/seed; definir a validação de CNPJ.
- **Segurança:** Troca de senha autenticada integrada nas configurações de médico e gestor, com senha atual, RN05, confirmação e novo login após sucesso; troca/recuperação revoga tokens anteriores no backend. Recuperação de senha já chama a API, mas envio real requer SMTP configurado. Login por papel com PIN SMTP, refresh rotativo de 30 dias absolutos, logout remoto e biometria local opcional integrados. Ver `backend/docs/contrato-auth-app.md` para contrato e limitações de rede; validar biometria e SMTP real em ambiente controlado.
- **Notificações:** entregar os eventos da outbox por push/e-mail, registrar dispositivo e implementar listagem/leitura e preferências no aplicativo. A interface atual informa indisponibilidade.
- **Resumo do gestor:** indicadores agregados de médicos, vagas e financeiro foram removidos por serem fictícios. Para retornarem, precisam de consultas agregadas no backend; a home hoje mostra uma página reduzida dos plantões reais.
- **Médicos e ponto:** busca/filtros no servidor, detalhes do profissional e eventual fluxo de contestação/ajuste de ponto precisam de contrato próprio. A consulta paginada está integrada; a tela de gestor não concede poderes de validação cadastral do administrador.
- **Regras de produto:** fechar compensações/estornos no cancelamento, validação cadastral institucional e contratos pendentes listados em `backend/docs/decisoes-pendentes.md`.
- **Operação:** validar o fluxo completo em dispositivo com contas reais (publicação → candidatura → aprovação → ponto → pagamento com comprovante), configurar HTTPS, SMTP e infraestrutura de produção. O modo HTTP/ADB do script é para desenvolvimento.

## Validação executada

Build e lint do backend; testes de presença/consultas com PGlite, incluindo autenticação, papel, isolamento institucional, paginação, exclusões e ausência de coordenadas; build e testes unitários Android, incluindo leitura das respostas novas.

## Validação desta frente de segurança

Backend: build, lint, 33 unitários e suíte e2e serial (18 arquivos); teste de replay com conexões PostgreSQL independentes. Android: 41 testes unitários e assembleDebug. Nenhum app instalado no celular compartilhado. Migrações de sessão precisam ser aplicadas antes do backend atualizado. Biometria física, SMTP/HTTPS e percurso completo em dispositivo ainda pendentes.
