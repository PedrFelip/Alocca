CREATE TABLE "entregas_notificacao" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"notificacao_id" uuid NOT NULL,
	"canal" text NOT NULL,
	"destino" text NOT NULL,
	"estado" text DEFAULT 'PENDENTE' NOT NULL,
	"tentativas" integer DEFAULT 0 NOT NULL,
	"proxima_at" timestamp DEFAULT now() NOT NULL,
	"lease_id" uuid,
	"lease_ate" timestamp,
	"erro_codigo" text,
	"enviada_at" timestamp
);
--> statement-breakpoint
ALTER TABLE "notificacoes" ADD COLUMN "processada_at" timestamp;--> statement-breakpoint
CREATE INDEX "notificacoes_expansao_idx" ON "notificacoes" ("created_at","id") WHERE "processada_at" IS NULL AND "status" = 'PENDENTE';--> statement-breakpoint
CREATE INDEX "notificacoes_inbox_cursor_idx" ON "notificacoes" ("usuario_destino_id","created_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "notificacoes_nao_lidas_idx" ON "notificacoes" ("usuario_destino_id") WHERE "lida_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "entregas_destino_unique" ON "entregas_notificacao" ("notificacao_id","canal","destino");--> statement-breakpoint
CREATE INDEX "entregas_fila_idx" ON "entregas_notificacao" ("estado","proxima_at");--> statement-breakpoint
CREATE INDEX "entregas_lease_idx" ON "entregas_notificacao" ("estado","lease_ate");--> statement-breakpoint
ALTER TABLE "entregas_notificacao" ADD CONSTRAINT "entregas_notificacao_notificacao_id_notificacoes_id_fkey" FOREIGN KEY ("notificacao_id") REFERENCES "notificacoes"("id") ON DELETE CASCADE;