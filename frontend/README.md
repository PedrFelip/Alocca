# Alocca Plantões — Android

Compose Material3, API HTTP autenticada e notificações nativas por **consulta periódica**, sem Firebase ou outro provedor push.

## Notificações

WorkManager agenda trabalho único com rede disponível a cada 15 minutos (mínimo permitido pelo Android). O sistema pode adiar por bateria/rede; force-stop interrompe até abrir o app. Ao abrir/retomar há sincronização adicional. Não há serviço permanentemente ativo nem promessa de entrega imediata.

A consulta usa `/notificacoes?somente_nao_lidas=true&limite=100`, percorre as páginas e respeita a preferência persistida `push` (nome legado do JSON, significa notificações no aparelho). E-mail é outro canal, entregue por worker no backend. Publicar na bandeja não marca como lida. O badge vem da contagem real do servidor.

IDs publicados ficam em SQLite por conta, sobrevivem a reinício/renovação/logout e não são truncados enquanto puderem reaparecer na inbox. O mesmo ID nativo substitui uma publicação repetida após crash entre publicar e persistir. Sem permissão Android, o item não é registrado como publicado e pode ser apresentado após conceder permissão. O toque usa UUID validado para navegar; dados vêm da API autenticada. Logout cancela trabalho, limpa a bandeja e revoga a sessão no servidor quando a rede permite.

Access e refresh ficam cifrados com AES-GCM/Android Keystore. Renovação é serializada, rotativa, e grava o par em um commit com comparação da sessão anterior. Resposta atrasada não deve desfazer logout/troca de conta. Sessão é revalidada antes/depois do HTTP e sob o mesmo lock de logout antes da publicação.

Contrato e operação backend: `backend/docs/notificacoes.md`.

## Build e testes

```bash
ANDROID_HOME=/caminho/Android/Sdk ./gradlew assembleDebug testDebugUnitTest
```

Backend padrão do emulador: `http://10.0.2.2:3000/`. Configurar `-PAloccaApiBaseUrl=http://10.0.2.2:3309/` para QA isolado ou variável `ALOCCA_API_BASE_URL`. O app debug permite HTTP local; produção deve usar HTTPS.

Para o teste instrumentado integrado:

1. Subir `compose.notifications-test.yaml` na raiz.
2. Em backend, executar `E2E_PG_ADMIN=postgresql://alocca_test:local-notifications-test@127.0.0.1:55439/postgres bun run test/support/preparar-notificacoes-android.ts`. Cria banco descartável e configuração `/tmp/alocca-android-qa.json`; não usa DATABASE_URL do ambiente normal.
3. Iniciar o backend compilado com essa configuração, porta 3309. O fixture usa conta médica `qa.notifications@example.test`, senha exclusivamente de teste `Senha-Teste-123`.
4. Com emulador iniciado, executar `adb reverse tcp:3309 tcp:3309` e `./gradlew connectedDebugAndroidTest -PAloccaApiBaseUrl=http://127.0.0.1:3309/`.

O teste executa o CoroutineWorker diretamente no Android (sem esperar 15 minutos), faz HTTP real com API/Postgres Docker, verifica preferência, notificação no NotificationManager, deduplicação SQLite, leitura PATCH idempotente, refresh real e logout. Não prova latência periódica sob Doze nem entrega em todos os fabricantes. Cada nova execução precisa de fixture com evento não lido.
