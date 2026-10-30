import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { DRIZZLE_DB, type Database } from "../db/db.provider.ts";
import {
  alocacoesTable,
  instituicoesTable,
  medicosTable,
  pagamentosTable,
  plantoesTable,
} from "../db/schemas/index.ts";
import type { DashboardFinanceiro } from "./financeiro.tipos.ts";

const CAMPOS_PAGAMENTO = {
  id: pagamentosTable.id,
  valor: pagamentosTable.valor,
  status: pagamentosTable.status,
  vencimento_em: pagamentosTable.vencimento_em,
  pago_at: pagamentosTable.pago_at,
  plantao: {
    id: plantoesTable.id,
    titulo: plantoesTable.titulo,
    data_inicio: plantoesTable.data_inicio,
    data_fim: plantoesTable.data_fim,
  },
  instituicao: {
    nome: instituicoesTable.nome,
    cidade: instituicoesTable.cidade,
    uf: instituicoesTable.uf,
  },
};

function visaoDoMedico(medicoId: string) {
  return and(
    eq(alocacoesTable.medico_id, medicoId),
    isNull(alocacoesTable.deleted_at),
    isNull(pagamentosTable.deleted_at),
    isNull(instituicoesTable.deleted_at),
  );
}

@Injectable()
export class FinanceiroService {
  constructor(@Inject(DRIZZLE_DB) private readonly db: Database) {}

  async doMedico(usuarioId: string): Promise<DashboardFinanceiro> {
    const medicoId = await this.perfilMedicoId(usuarioId);
    const visao = visaoDoMedico(medicoId);

    // REPEATABLE READ compartilha um único snapshot entre resumo e lista; em
    // READ COMMITTED uma baixa concorrente poderia aparecer só em um deles.
    return this.db.transaction(
      async (tx) => {
        const linhasResumo = await tx
          .select({
            total_recebido: sql<string>`coalesce(sum(case when ${pagamentosTable.status} = 'PAGO' then ${pagamentosTable.valor} else 0 end), 0)::text`,
            total_a_receber: sql<string>`coalesce(sum(case when ${pagamentosTable.status} = 'PENDENTE' and (${pagamentosTable.vencimento_em} is null or ${pagamentosTable.vencimento_em} >= now()) then ${pagamentosTable.valor} else 0 end), 0)::text`,
            total_pendente: sql<string>`coalesce(sum(case when ${pagamentosTable.status} = 'PENDENTE' and ${pagamentosTable.vencimento_em} < now() then ${pagamentosTable.valor} else 0 end), 0)::text`,
          })
          .from(pagamentosTable)
          .innerJoin(
            alocacoesTable,
            eq(pagamentosTable.alocacao_id, alocacoesTable.id),
          )
          .innerJoin(
            plantoesTable,
            eq(alocacoesTable.plantao_id, plantoesTable.id),
          )
          .innerJoin(
            instituicoesTable,
            eq(plantoesTable.instituicao_id, instituicoesTable.id),
          )
          .where(visao);
        const pagamentos = await tx
          .select(CAMPOS_PAGAMENTO)
          .from(pagamentosTable)
          .innerJoin(
            alocacoesTable,
            eq(pagamentosTable.alocacao_id, alocacoesTable.id),
          )
          .innerJoin(
            plantoesTable,
            eq(alocacoesTable.plantao_id, plantoesTable.id),
          )
          .innerJoin(
            instituicoesTable,
            eq(plantoesTable.instituicao_id, instituicoesTable.id),
          )
          .where(visao)
          .orderBy(desc(plantoesTable.data_inicio));

        return { resumo: linhasResumo[0]!, pagamentos };
      },
      { isolationLevel: "repeatable read", accessMode: "read only" },
    );
  }

  private async perfilMedicoId(usuarioId: string) {
    const [medico] = await this.db
      .select({ id: medicosTable.id })
      .from(medicosTable)
      .where(
        and(
          eq(medicosTable.usuario_id, usuarioId),
          isNull(medicosTable.deleted_at),
        ),
      )
      .limit(1);
    if (!medico) {
      throw new NotFoundException("Perfil médico não encontrado");
    }
    return medico.id;
  }
}
