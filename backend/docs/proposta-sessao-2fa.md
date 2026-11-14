# Proposta de sessão mobile e 2FA — D9

Estado: **proposta aprovada pelo usuário em 14/11/2026; implementado; ver contrato-auth-app.md para detalhes e limitações**.
A troca de senha autenticada é independente desta proposta. Mantêm-se as convenções
atuais (snake_case, sem `/api/v1`, D18); não se migram todos os UCs nesta frente.

## Decisões aprovadas

1. Manter access JWT de 15 minutos (configuração atual). Challenge opaco aleatório,
   de uso único, 5 minutos. Refresh opaco aleatório, 30 dias absolutos por família,
   sem extensão deslizante; rotação em cada uso. Reutilização revoga a família.
2. PIN por e-mail no login inicial (6 dígitos, 5 minutos, RN10), SMTP existente.
   Biometria Android apenas desbloqueia localmente credenciais protegidas pelo
   Keystore. Alinhamento de RN09 aprovado: um booleano do cliente
   não comprova biometria no servidor. A alternativa de chave de dispositivo no servidor não foi adotada nesta etapa.
3. Novas rotas mobile por papel; preservar `/auth/login` legado nesta transição.
   Esse legado não passa a exigir 2FA: sua retirada/exclusividade administrativa
   requer migração coordenada dos consumidores. Sem SMTP, login mobile não deve
   emitir sessão nem simular sucesso. PIN: 5 erros invalidam desafio; 3 envios por
   conta em 15 minutos; reenvio invalida o anterior. Somar limite por IP.

## Contrato aprovado

- `POST /auth/login/medico` e `/auth/login/gestor`: `{email, senha}` →
  `{challenge_token, requer_2fa: true, expires_in}`; nenhum access token antes do PIN.
- `POST /auth/2fa/solicitar-pin`: `{challenge_token}` → resposta genérica sem PIN.
- `POST /auth/2fa/validar-pin`: `{challenge_token, pin_code}` → sessão com
  `access_token, token_type, expires_in, refresh_token, refresh_expires_in, usuario`.
- `POST /auth/refresh`: `{refresh_token}` → novo par; consumir anterior e criar
  sucessor atomicamente. Falha definitiva limpa sessão; indisponibilidade de rede
  não apaga credenciais. Android serializa renovações concorrentes, repete uma
  requisição autenticada no máximo uma vez e nunca entra em ciclo de refresh.
- `POST /auth/logout`: revoga família identificada pelo refresh, resposta idempotente.
  App apaga credenciais locais mesmo quando offline; sem conexão, revogação remota
  não pode ser garantida. Revogação de access exige guard consultar sessão ativa.

## Invariantes para implementação após alinhamento

Guardar apenas hash de challenge, PIN e refresh no servidor; nunca logs de
Authorization, senhas, PIN, tokens ou corpos sensíveis. Verificar status de conta
na emissão, renovação e guard. Troca/recuperação revoga todas as famílias e códigos
pendentes na mesma transação da senha. Logout não revoga famílias de outros aparelhos.
PIN consumido e rotação devem resistir a concorrência; reapresentação de refresh
consumido revoga família, inclusive sucessores. Android guarda tokens cifrados com
chave Keystore, exclui de backup e não persiste senha/PIN. Perda/invalidação da chave
exige login. Recovery existente continua genérico, de uso único e independente do
challenge; não deve emitir sessão automaticamente.

Validação prevista: contratos por papel, ausência de sessão antes do PIN, expiração,
limites, reenvio, consumo concorrente, replay/rotação, logout, recovery, contas
inativas, restauração Android, 401 concorrentes, erros de rede e ausência de segredos.
Pendência operacional: SMTP real e HTTPS em produção; não instalar em celular
compartilhado para validar esta frente.
