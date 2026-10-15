# Alocca Admin

Painel administrativo independente em Svelte 5, TypeScript e Vite. O projeto
Astro em `../web` não é utilizado por este painel.

## Executar

Com o PostgreSQL e o backend em execução e as migrações aplicadas:

```sh
cd admin
bun install
cp .env.example .env
bun run dev
```

Acesse http://localhost:5173. `VITE_API_URL` define a URL do backend e precisa
ser configurada antes do build. O padrão é `/api`; em desenvolvimento, o Vite
encaminha essas requisições para `http://localhost:3000`, sem depender do CORS
do navegador. Se mudar a porta do backend, ajuste o target em `vite.config.ts`.
Em produção, configure um proxy `/api` no servidor ou defina `VITE_API_URL`
com a URL absoluta do backend antes do build. O proxy do Vite é apenas para `dev`.
No backend, `ADMIN_WEB_ORIGIN` permite o acesso por CORS e tem como padrão
`http://localhost:5173`. Reinicie o backend após alterar essa variável.

O backend cria o admin inicial configurado por `ADMIN_EMAIL` e `ADMIN_PASSWORD`.
No ambiente local, o login inicial é `admin@alocca.local` / `AloccaAdmin@2026`.
O login exige uma conta ativa do tipo `ADMIN`. Não existe cadastro público
de administradores: a promoção de uma conta é feita por um operador confiável,
conforme o README do backend. O painel não inclui credenciais de demonstração.

## Funcionalidades

- Login, restauração da sessão na mesma aba e logout ao expirar o JWT.
- Visão geral com indicadores da fila real de cadastros pendentes.
- Busca, filtro por UF, paginação e ordenação pelos cadastros mais antigos.
- Análise manual com link para o CFM, confirmação de registro e identidade.
- Aprovação e rejeição com motivo, enviando o CRM/UF conferido para a API.
- Tratamento de falhas de conexão e conflitos quando o cadastro foi alterado.
- Navegação responsiva, preparada para futuros módulos administrativos.

Instituições, plantões, usuários e financeiro aparecem como módulos futuros.
A especialidade é declarada e esta análise não valida RQE.

O token fica em `sessionStorage`, sem armazenar a senha. Não há refresh token;
após a expiração, é necessário entrar novamente. As permissões continuam
validadas pelo backend em cada solicitação.

## Estrutura

`src/components` contém login, fila e diálogo de análise. `src/lib` reúne
cliente da API, tipos, sessão e definição da navegação. `App.svelte` coordena
sessão e páginas; `styles.css` concentra o estilo responsivo.

## Verificar e gerar build

```sh
bun run check
bun run build
bun run preview
```

O build é gerado em `dist/` e pode ser servido por um servidor estático.
