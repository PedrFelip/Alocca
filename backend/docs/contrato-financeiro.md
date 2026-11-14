# Financeiro — UC08/UC12

Contrato implementado sem prefixo `/api/v1`, como as demais rotas atuais. Todas exigem Bearer token válido.

- `GET /financeiro/medico` (MEDICO): resumo e pagamentos próprios. Valores monetários são strings decimais. `total_recebido` soma PAGO; `total_a_receber` soma PENDENTE sem vencimento ou com vencimento >= relógio do banco; `total_pendente` soma PENDENTE com vencimento anterior ao relógio. Vencimento explícito, sem prazo automático. Plantões cancelados/excluídos não entram.
- `GET /financeiro/pendentes-baixa` (GESTOR ativo): array com `id`, `valor`, `status`, `vencimento_em`, `pago_at`, `plantao {id,titulo,data_inicio,data_fim}`, `instituicao {nome,cidade,uf}`, `medico {nome}`. Somente instituições vinculadas, registros não excluídos, plantões não cancelados já encerrados e pagamento PENDENTE. Encerramento não implica atraso.
- `POST /financeiro/pagamentos/:id/dar-baixa` (GESTOR ativo): multipart com exatamente um arquivo `comprovante`, PDF/JPG/JPEG/PNG, até 5 MiB, não vazio, extensão/MIME/assinatura compatíveis. Sem outros campos. Nome substituído por UUID. 200 com `{message: MSG-18}` após commit, 400 arquivo ausente/inválido, 413 acima do limite, 404 fora do escopo, 409 já pago ou plantão futuro. Status, gestor, horário do banco e referência são persistidos juntos. A segunda baixa concorrente espera o lock e recebe 409. A transação também bloqueia em modo compartilhado os registros de autorização/eligibilidade e revalida antes de atualizar: uma revogação/cancelamento que concluiu primeiro impede a baixa; se a baixa obteve os locks primeiro, a alteração aguarda o commit. Pagamentos diferentes da mesma instituição podem executar uploads em paralelo.
- `GET /financeiro/comprovantes/:id` (MEDICO): apenas proprietário com pagamento PAGO. 200 binário, MIME PDF/JPEG/PNG, Content-Disposition attachment com UUID, Cache-Control private,no-store e nosniff. 404 para pagamento de outro médico, pendente ou arquivo ausente (inclusive legado pago sem comprovante). 503 em falha do storage. Nunca retorna URL/chave no JSON. 401 sessão ausente/expirada e 403 papel incorreto.

## Operação SeaweedFS

`docker compose up -d seaweedfs` sobe Filer persistente. Backend local usa `SEAWEEDFS_FILER_URL=http://127.0.0.1:8888`; dentro da rede Compose, `http://seaweedfs:8888`. O Filer fica restrito à interface loopback no desenvolvimento. Em produção, mantenha-o em rede privada acessível apenas ao backend, sem ingress público e sem acesso pelos dispositivos. Não publique master/volume/filer. O volume `seaweedfs_data` precisa de backup junto com o Postgres. Execute as migrations antes do backend.

O upload tem timeout e a baixa mantém lock durante o upload. Após upload confirmado e falha no banco, uma nova transação bloqueia a linha para aguardar a resolução do commit original antes de verificar a referência e excluir órfão. Timeout do upload tem resultado incerto: preserva o objeto e emite log para reconciliação, pois o PUT remoto ainda pode terminar depois da falha local. Falha de limpeza emite `COMPROVANTE_RECONCILIAR` (chave e pagamento). A baixa bem-sucedida emite `PAGAMENTO_BAIXADO` com pagamento e gestor; persistência também registra `pago_at` e `registrado_por_gestor_id`.

Queda do processo após upload e antes de commit pode deixar órfão. Reconciliação operacional: comparar objetos de `/comprovantes` com `pagamentos.comprovante_chave` usando o banco primário saudável; excluir somente os não referenciados e antigos o suficiente para nenhuma transação/upload estar em andamento. Nunca apagar em indisponibilidade ou resultado incerto do banco. Não há worker automático de reconciliação nesta entrega. Pagamentos PAGO legados sem arquivo continuam sem download.

Android usa seletor de documentos para upload e confirmação explícita da baixa. Download envia Bearer pela API e permite salvar pelo seletor de destino do Android, sem permissões amplas de armazenamento. Os bytes ficam apenas em memória até a escolha do destino; não há arquivo temporário em disco. Após recriação do processo, uma nova busca autenticada recupera os bytes. O cache legado de comprovantes é removido em IO na inicialização/retomada (onResume), sem afetar os documentos salvos pelo usuário.

## Validação reproduzível com Docker

Na raiz, `docker compose -p alocca-financeiro-qa -f compose.financeiro-test.yaml up -d --wait` provisiona PostgreSQL 17 e SeaweedFS 4.00 em portas de teste isoladas. Depois, em `backend/`:

```sh
E2E_FINANCEIRO_PG_ADMIN=postgresql://postgres:teste-local-financeiro@127.0.0.1:15432/postgres \
E2E_PG_ADMIN=postgresql://postgres:teste-local-financeiro@127.0.0.1:15432/postgres \
E2E_SEAWEEDFS_FILER_URL=http://127.0.0.1:18889 bun run test:e2e
```

A suíte financeira cria e remove seu próprio banco temporário, testa requisições concorrentes com conexões independentes e executa upload/download autenticados com o Filer real. Sem as variáveis, usa PGlite e pula somente as integrações que exigem os serviços reais. Ao terminar, `docker compose -p alocca-financeiro-qa -f compose.financeiro-test.yaml down -v` remove exclusivamente os recursos de teste.

No Android: `ANDROID_HOME=/caminho/do/sdk ./gradlew :app:testDebugUnitTest` em `frontend/`. Os testes de transporte usam servidor HTTP local e verificam Bearer, multipart, resposta binária, valores decimais e falhas HTTP.

A suíte também cobre revogação de vínculo, inativação/exclusão de gestor, bloqueio de usuário, cancelamento/exclusão/adiamento de plantão e exclusão de instituição/alocação antes da transação e durante o upload. Os testes concorrentes verificam bloqueios em uma conexão PostgreSQL independente. Um teste com barreira comprova que dois uploads de pagamentos distintos podem avançar juntos, sem serialização por gestor/instituição. No Android há testes da gravação direta em memória/destino, recuperação sem bytes preparados, falhas de autenticação/escrita e remoção do cache legado.
