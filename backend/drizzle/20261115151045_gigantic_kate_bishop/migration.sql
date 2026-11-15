ALTER TABLE "notificacoes" ADD COLUMN "email_elegivel" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "notificacoes" ADD COLUMN "entrega_token" uuid;--> statement-breakpoint
ALTER TABLE "notificacoes" ADD COLUMN "entrega_ate" timestamp;--> statement-breakpoint
DROP INDEX "notificacoes_fila_idx";--> statement-breakpoint
CREATE INDEX "notificacoes_fila_idx" ON "notificacoes" ("email_elegivel","status","created_at");