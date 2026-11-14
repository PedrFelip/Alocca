# Consultas do gestor: médicos e ponto

Contrato de leitura implementado, seguindo D18: rotas sem `/api/v1`, campos snake_case e resposta JSON em array. Exige Bearer de usuário GESTOR ativo. Não concede poderes administrativos sobre cadastro nem presença.

## Escopo e paginação

`GET /gestor/medicos` lista médicos distintos vinculados por alocações não excluídas (RN14), em instituições ativas vinculadas ao gestor. `GET /gestor/ponto` lista eventos dessas alocações. Exclusões lógicas de usuários, médicos, alocações, plantões e instituições são respeitadas. Nunca se consulta um catálogo global de médicos.

Ambos aceitam `limit` (inteiro 1–50, padrão 20), `offset` (inteiro >= 0, padrão 0) e `instituicao_id` opcional (UUID, sempre combinado com o escopo autorizado). Instituição fora do escopo resulta em lista vazia sem revelar sua existência. Campos desconhecidos ou filtros inválidos retornam 400.

Ordenação: médicos por nome e ID crescentes; ponto por timestamp do servidor e ID decrescentes. Filtros são aplicados antes da paginação. Não há total na resposta; página menor que limit encerra a consulta, página cheia pode exigir uma consulta vazia adicional. Mudança de filtro reinicia offset em zero.

Ordenação determinística não constitui snapshot: inserções, exclusões ou alterações concorrentes entre páginas podem deslocar offsets. Atualizar reinicia a consulta. Cursor/snapshot fica como evolução de contrato, em linha com D22.

A consulta preserva o comportamento histórico já existente: alocações pagas não são removidas da leitura. A visão geral do spec descreve extinção do vínculo após pagamento, mas não define retenção e autoridade de consulta histórica. Produto deve esclarecer essa política antes de ampliar acesso ou retenção; esta frente não cria vínculo permanente nem altera o escopo institucional existente.

## Filtros de médicos

- `q`: trecho literal, sem distinção de maiúsculas, em nome, CRM ou especialidade. `%`, `_` e barra invertida não funcionam como curingas. Texto aparado, de 1 a 150 caracteres.
- `especialidade`: trecho literal sem distinção de maiúsculas, aparado, de 1 a 150 caracteres.
- `uf_crm`: UF brasileira do CRM, aparada e normalizada para maiúsculas.
- `status`: `ATIVO`, `INATIVO`, `BLOQUEADO`; `status_validacao`: `PENDENTE`, `APROVADO`, `REJEITADO`. Não inferem vínculo empregatício nem concedem validação ao gestor.

Os filtros combinam-se por AND; os três campos pesquisados por q combinam-se por OR. Busca não remove acentos nem faz aproximação fonética.

## Filtros de ponto

- `medico_id`: UUID de `medicos.id`, não de `usuarios.id`; combinado com o escopo institucional.
- `tipo_evento`: `ENTRADA` ou `SAIDA`.
- `inicio` e `fim`: timestamps RFC3339 com `Z` ou offset explícito. Ambos opcionais; quando juntos, inicio deve preceder fim. Datas sem fuso ou impossíveis são rejeitadas.

O intervalo é `[inicio, fim)`, sobre `timestamp_servidor`, não sobre a data do plantão. Exemplo: o dia 14/11/2026 em São Paulo corresponde a `inicio=2026-11-14T00:00:00-03:00&fim=2026-11-15T00:00:00-03:00` (codificar parâmetros na URL). O cliente converte dias no fuso do dispositivo, usando o início do dia seguinte para o limite superior; não soma 24 horas fixas. Exibição segue o fuso do dispositivo. Coordenadas não são expostas, apenas `com_localizacao`.

As colunas atuais são `timestamp` sem fuso e seguem a convenção UTC existente. O cliente Postgres do backend fixa a sessão em UTC (`src/db/cliente-postgres.ts`); filtros são normalizados como instantes antes de comparar. Escritas externas que ignorem essa convenção podem produzir dados incorretos e precisam ser auditadas na operação.

## Contestação/ajuste: proposta, não implementada

Decisão de produto nesta thread (14/11/2026): **manter somente consulta por enquanto**. A proposta abaixo fica como referência futura, sem autorização para implementar escrita.

UC06/RN19 autorizam ação explícita do médico com timestamp do servidor; D20 define janelas. Não há UC, autoridade ou regra que permita ao gestor reescrever presença ou registrar-se como médico. Nenhuma rota de escrita foi adicionada nesta frente.

Proposta para decisão de produto: recurso separado de contestação, ligado ao registro original e à alocação, com ID próprio, autor autenticado, motivo, instante de criação do servidor, valor solicitado, estado e versão. Decisões devem ser eventos anexados, com responsável autenticado, justificativa, instante do servidor e referência à solicitação. Aprovação geraria uma retificação separada, preservando integralmente o registro original e suas coordenadas; nunca UPDATE/DELETE de histórico nem POST /presenca em nome de terceiro. A leitura distinguiria dado capturado e eventual dado efetivo retificado.

Antes de implementar, produto precisa decidir: quem solicita e quem decide (inclusive conflito de interesse), quais campos podem mudar, prazo, evidências e retenção LGPD, registro ausente, efeitos em pagamento já baixado e contestação/recurso. Depois disso, definir endpoints e estados finais, autorização institucional em cada operação, idempotência, controle de concorrência e transação atômica de decisão/retificação/auditoria. Esta proposta não cria permissões ou regras de negócio.
