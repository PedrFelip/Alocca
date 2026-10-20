ALTER TABLE "usuarios" ADD COLUMN "tentativas_falhas" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "usuarios" ADD COLUMN "bloqueado_ate" timestamp;
