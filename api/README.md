# Alocca API — Bruno

No Bruno, escolha **Open Collection** e abra esta pasta `api`. Selecione o
ambiente **Local**. Inicie o banco, aplique as migrações e execute o backend
antes de enviar as requisições. A URL padrão é `http://localhost:3000`.

As pastas agrupam as rotas atuais: Sistema, Auth, Usuarios e Admin. Os testes
de cada requisição conferem status e, quando aplicável, o conteúdo da resposta.

## Fluxo de teste

1. Execute **Health** e **Login admin**. O login local configurado é
   `admin@alocca.local` / `AloccaAdmin@2026`.
2. Execute **Cadastrar medico**, depois **Login medico**. Os dados de exemplo
   estão no ambiente Local; use outro e-mail e CRM se já estiverem cadastrados.
3. Consulte o perfil e experimente atualizar nome, telefone e especialidade.
4. Execute **Listar pendentes e selecionar medico de teste**. O script seleciona
   apenas o cadastro cujo e-mail corresponde a `medicoEmail`, e guarda ID e
   CRM/UF retornados pela API. Confira os dados antes da decisão.
5. Execute **Aprovar medico selecionado** ou **Rejeitar medico selecionado**.
   São alternativas: uma segunda decisão sobre o mesmo cadastro retorna 409.
6. Para testar uma nova análise, execute **Alterar CRM e voltar a pendente**,
   liste os pendentes novamente e então envie outra decisão.
7. **Medico nao pode listar pendentes** deve retornar 403.

Execute as requisições manualmente nessa ordem; rodar a coleção inteira de uma
vez mistura aprovação, rejeição e mudança de CRM. Cadastro repetido retorna 409.
As decisões alteram o banco configurado, então use dados de teste.

Os logins guardam `adminToken` e `medicoToken` como variáveis de execução com
`bru.setVar`, sem gravar tokens nos arquivos. Após expiração ou reiniciar o
Bruno, faça login novamente. ID e CRM/UF também são variáveis de execução;
nenhuma decisão escolhe automaticamente o primeiro médico da fila.
