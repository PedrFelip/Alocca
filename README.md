<div align="center">

# Alocca

### Plantões conectados. Gestão simplificada.

Uma plataforma para conectar médicos e instituições de saúde, organizar plantões e acompanhar a operação em um só lugar.

![Android](https://img.shields.io/badge/Android-3DDC84?style=for-the-badge&logo=android&logoColor=white)
![Kotlin](https://img.shields.io/badge/Kotlin-7F52FF?style=for-the-badge&logo=kotlin&logoColor=white)
![Jetpack Compose](https://img.shields.io/badge/Jetpack_Compose-4285F4?style=for-the-badge&logo=jetpackcompose&logoColor=white)

![NestJS](https://img.shields.io/badge/NestJS-E0234E?style=for-the-badge&logo=nestjs&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?style=for-the-badge&logo=typescript&logoColor=white)
![Svelte](https://img.shields.io/badge/Svelte-FF3E00?style=for-the-badge&logo=svelte&logoColor=white)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-4169E1?style=for-the-badge&logo=postgresql&logoColor=white)

[Sobre](#sobre) · [Tecnologias](#tecnologias) · [Como executar](#como-executar) · [Documentação](#documentação)

</div>

---

## Sobre

O **Alocca** digitaliza a gestão de plantões médicos: da publicação de uma oportunidade à candidatura, alocação e acompanhamento financeiro. O projeto reúne um aplicativo Android para médicos e gestores, uma API REST e um painel web para a análise administrativa de cadastros.

| Para médicos                                       | Para gestores                                             |
| :------------------------------------------------- | :-------------------------------------------------------- |
| Consultar oportunidades e candidatar-se a plantões | Publicar e gerenciar plantões das instituições vinculadas |
| Acompanhar plantões e registros de presença        | Avaliar candidaturas e alocar profissionais               |
| Consultar valores e baixar comprovantes            | Registrar pagamentos e anexar comprovantes                |

## Tecnologias

| Camada                | Tecnologias                            | Papel no projeto                                      |
| :-------------------- | :------------------------------------- | :---------------------------------------------------- |
| Aplicativo Android    | Kotlin · Jetpack Compose · Material 3  | Interface nativa para médicos e gestores              |
| Painel administrativo | Svelte 5 · TypeScript · Vite · Lucide  | Análise e validação dos cadastros médicos             |
| API                   | NestJS · TypeScript · Zod · JWT        | Regras de negócio, validação e controle de acesso     |
| Persistência          | PostgreSQL 17 · Drizzle ORM            | Dados relacionais, consultas e migrações              |
| Arquivos              | SeaweedFS                              | Armazenamento privado de comprovantes                 |
| Desenvolvimento       | Bun · Docker Compose · Bruno           | Dependências, infraestrutura local e requisições HTTP |
| Qualidade             | Vitest · PGlite · JUnit · Svelte Check | Testes e verificações dos módulos                     |

<div align="center">

![Bun](https://img.shields.io/badge/Bun-14151A?style=flat-square&logo=bun&logoColor=white)
![Vite](https://img.shields.io/badge/Vite-646CFF?style=flat-square&logo=vite&logoColor=white)
![Drizzle](https://img.shields.io/badge/Drizzle-1C1C1C?style=flat-square&logo=drizzle&logoColor=C5F74F)
![Docker](https://img.shields.io/badge/Docker-2496ED?style=flat-square&logo=docker&logoColor=white)
![Vitest](https://img.shields.io/badge/Vitest-729B1B?style=flat-square&logo=vitest&logoColor=white)
![Bruno](https://img.shields.io/badge/Bruno-F4AA41?style=flat-square&logo=bruno&logoColor=white)

</div>

## Organização do repositório

```text
Alocca/
├── frontend/       # Aplicativo Android em Kotlin e Jetpack Compose
├── admin/          # Painel administrativo em Svelte
├── backend/        # API NestJS, schemas, migrações e testes
├── api/            # Coleção de requisições do Bruno
├── compose.yaml    # PostgreSQL e SeaweedFS para desenvolvimento
└── LICENSE         # Licença MIT
```

## Como executar

### Iniciar backend e app no celular com um comando

Com **Bun**, **Docker Compose**, **Python 3**, **curl**, **ADB**, **Android SDK 37** e **JDK 25** instalados, conecte o celular com depuração USB ativada e autorize o computador. Deixe celular e computador na mesma rede e execute:

```sh
./scripts/dev-android.sh
```

O script inicia PostgreSQL e SeaweedFS, instala as dependências do backend, aplica as migrações, expõe a API em `0.0.0.0:3000` e compila, instala e abre o app com o IP local detectado. Cria `backend/.env` quando necessário e gera um JWT e uma senha administrativa se estiverem vazios ou com a senha de exemplo; consulte a senha em `backend/.env`. O banco e o armazenamento continuam acessíveis apenas pela máquina.

Para escolher o IP da interface de rede, o celular ou a porta:

```sh
./scripts/dev-android.sh --ip 192.168.1.100 --device SERIAL_DO_ADB --port 3000
```

Se o acesso pela rede falhar, use `./scripts/dev-android.sh --usb` para encaminhar a conexão do app pelo ADB. O backend continua exposto na rede; mantenha o celular conectado.

Use `adb devices` para consultar o serial. Também funciona com um celular já conectado por ADB sem fio. Libere a porta TCP escolhida no firewall da rede local. Mantenha o terminal aberto; `Ctrl+C` encerra a API e mantém os containers e dados. O script não executa o seed nem inicia o painel administrativo.

### 1. Prepare o ambiente

Tenha **Bun**, **Docker com Compose** e, para o aplicativo, **Android Studio, Android SDK 37 e JDK 25**. Execute os comandos abaixo a partir da raiz do repositório, salvo indicação contrária.

Inicie o banco e o armazenamento de arquivos:

```sh
docker compose up -d --wait db seaweedfs
```

### 2. Configure a API

```sh
cd backend
bun install
cp .env.example .env
openssl rand -hex 32
```

Copie o segredo gerado para `JWT_SECRET` no arquivo `backend/.env`. Confira também:

| Variável                         | Configuração local                                     |
| :------------------------------- | :----------------------------------------------------- |
| `DATABASE_URL`                   | `postgresql://postgres:postgres@localhost:5432/alocca` |
| `SEAWEEDFS_FILER_URL`            | `http://127.0.0.1:8888`                                |
| `ADMIN_WEB_ORIGIN`               | `http://localhost:5173`                                |
| `ADMIN_EMAIL` e `ADMIN_PASSWORD` | Credenciais do administrador criado na inicialização   |

Use um segredo próprio e substitua as credenciais de exemplo antes de expor a API à rede. O SeaweedFS deve permanecer privado; os downloads são autorizados pela API.

Ainda em `backend/`, aplique as migrações e inicie o servidor:

```sh
bun run migrate
bun run dev
```

A API fica disponível em **http://localhost:3000**.

<details>
<summary><strong>Dados de demonstração</strong></summary>

Em outro terminal, dentro de `backend/`, execute:

```sh
bun run seed
```

O seed cria um gestor, três hospitais e um médico aprovado, com plantões e dados para demonstração. Consulte as credenciais e o comando para renovar as datas no [guia do backend](backend/README.md#configuração).

</details>

### 3. Inicie o painel administrativo

Em outro terminal, a partir da raiz:

```sh
cd admin
bun install
cp .env.example .env
bun run dev
```

Acesse **http://localhost:5173** e entre com as credenciais de administrador configuradas no backend. Durante o desenvolvimento, o Vite encaminha `/api` para `http://localhost:3000`.

### 4. Execute o aplicativo Android

Abra a pasta `frontend/` no Android Studio, sincronize o Gradle e execute o app em um emulador ou dispositivo.

A URL padrão da API é `http://10.0.2.2:3000/`, que aponta para a máquina hospedeira no emulador Android. Para usar um dispositivo físico, configure `HOST=0.0.0.0` no backend, reinicie a API e informe o IP da máquina no build:

```sh
cd frontend
./gradlew assembleDebug -PAloccaApiBaseUrl=http://192.168.1.100:3000/
```

Substitua o IP pelo endereço da sua máquina e permita o acesso à porta `3000` na rede local. A URL também pode ser definida pela variável de ambiente `ALOCCA_API_BASE_URL`.

## Verificações

Execute cada grupo de comandos na pasta indicada:

| Módulo  | Comandos                                                               |
| :------ | :--------------------------------------------------------------------- |
| Backend | `bun run build` · `bun run lint` · `bun run test` · `bun run test:e2e` |
| Painel  | `bun run check` · `bun run build`                                      |
| Android | `./gradlew testDebugUnitTest` · `./gradlew assembleDebug`              |

Parte dos testes de integração do backend exige PostgreSQL com permissão `CREATEDB`, configurado por `E2E_PG_ADMIN`. Consulte os requisitos no [guia do backend](backend/README.md#verificação).

Para explorar as rotas manualmente, abra `api/` no **Bruno**, selecione o ambiente **Local** e siga o [fluxo de requisições](api/README.md).

## Documentação

- [Backend](backend/README.md) — configuração, autenticação, permissões e regras dos plantões.
- [Painel administrativo](admin/README.md) — execução, sessão e análise de médicos.
- [Coleção Bruno](api/README.md) — requisições e roteiro de teste manual.
- [Contrato financeiro](backend/docs/contrato-financeiro.md) — pagamentos e comprovantes.
- [Contrato de autenticação do app](backend/docs/contrato-auth-app.md) — integração com o Android.
- [Decisões pendentes](backend/docs/decisoes-pendentes.md) — pontos de produto e contratos em definição.

## Licença

Distribuído sob a [licença MIT](LICENSE). Copyright © 2026 Pedro Felipe.
