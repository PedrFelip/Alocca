# Indicadores da home do gestor

`GET /gestor/indicadores` exige Bearer token válido de usuário GESTOR ativo e perfil de gestor ativo e não excluído. Retorna 401 para sessão inválida e 403 para papel incorreto ou perfil de gestor indisponível.

```json
{
  "periodo": "todo_historico",
  "atualizado_em": "2026-11-14T12:00:00.000Z",
  "plantoes": 2,
  "medicos_vinculados": 1,
  "vagas_preenchidas": 2,
  "pagamentos": {
    "total_pago": "1000.00",
    "total_a_pagar": "500.00",
    "total_em_atraso": "0"
  }
}
```

O escopo é **todo o histórico elegível**, sem filtro temporal, inclusive plantões futuros. Consideram-se somente instituições atualmente ativas, não excluídas e vinculadas ao gestor no momento da consulta. Plantões excluídos ou cancelados não entram. `plantoes` conta cada plantão elegível uma vez, inclusive sem alocações.

Alocações elegíveis não estão excluídas e pertencem a plantões elegíveis e a médicos e usuários não excluídos. `vagas_preenchidas` conta essas alocações; `medicos_vinculados` conta médicos distintos nelas. Um médico com pagamento efetuado continua no indicador histórico enquanto sua alocação for elegível. Portanto, esse número não representa o vínculo transacional vigente da RN14, que se extingue após o pagamento. Status ativo do médico não é exigido.

Os pagamentos não excluídos dessas alocações são somados em decimal no banco: `total_pago` inclui PAGO; `total_a_pagar` inclui PENDENTE com vencimento nulo ou maior ou igual ao instante da consulta; `total_em_atraso` inclui PENDENTE com vencimento anterior a esse instante. Não se exige que o plantão tenha terminado e não existe vencimento automático. Valores são strings decimais, inclusive zero; contagens são inteiros. `atualizado_em` é o instante do relógio do banco em ISO 8601 UTC, usado também para classificar vencimentos. A consulta usa um único snapshot para os indicadores.

## Validação

A suíte `test/gestor-indicadores.e2e-spec.ts` exercita a rota HTTP com banco PGlite e migrations reais: autenticação/papel, gestor indisponível, revogação institucional, isolamento, instituições inativas, exclusões, médico distinto em mais de uma instituição, múltiplos pontos sem multiplicar valores, histórico vazio e totais exatos em centavos. O caso de igualdade entre vencimento e instante de referência usa uma transação com `now()` estável para comprovar que ainda está no prazo.

Comando: `bun run test:e2e --maxWorkers=2` em `backend/`. Limitar workers evita disputar memória de várias instâncias PGlite com o build Android. A validação visual e de acessibilidade em dispositivo continua pendente; nenhum aplicativo foi instalado no dispositivo compartilhado. Filtros por período e séries temporais não fazem parte deste contrato.
