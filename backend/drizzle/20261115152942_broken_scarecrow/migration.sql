CREATE TABLE "desafios_mobile" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"usuario_id" uuid NOT NULL,
	"token_hash" varchar(64) NOT NULL UNIQUE,
	"pin_hash" varchar(64),
	"pin_enviado" boolean DEFAULT false NOT NULL,
	"pin_expires_at" timestamp,
	"erros" integer DEFAULT 0 NOT NULL,
	"expires_at" timestamp NOT NULL,
	"used_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "envios_pin" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"usuario_id" uuid NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "refresh_mobile" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"sessao_id" uuid NOT NULL,
	"token_hash" varchar(64) NOT NULL UNIQUE,
	"used_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "sessoes_mobile" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"usuario_id" uuid NOT NULL,
	"expires_at" timestamp NOT NULL,
	"revoked_at" timestamp
);
--> statement-breakpoint
ALTER TABLE "usuarios" ADD COLUMN "versao_sessao" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "usuarios" ADD COLUMN "tentativas_alteracao_senha" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "usuarios" ADD COLUMN "inicio_tentativas_alteracao_senha" timestamp;--> statement-breakpoint
CREATE INDEX "desafios_mobile_usuario_idx" ON "desafios_mobile" ("usuario_id");--> statement-breakpoint
CREATE INDEX "desafios_mobile_expira_idx" ON "desafios_mobile" ("expires_at");--> statement-breakpoint
CREATE INDEX "envios_pin_usuario_data_idx" ON "envios_pin" ("usuario_id","created_at");--> statement-breakpoint
CREATE INDEX "envios_pin_data_idx" ON "envios_pin" ("created_at");--> statement-breakpoint
CREATE INDEX "refresh_mobile_sessao_idx" ON "refresh_mobile" ("sessao_id");--> statement-breakpoint
CREATE INDEX "sessoes_mobile_usuario_idx" ON "sessoes_mobile" ("usuario_id");--> statement-breakpoint
CREATE INDEX "sessoes_mobile_expira_idx" ON "sessoes_mobile" ("expires_at");--> statement-breakpoint
ALTER TABLE "desafios_mobile" ADD CONSTRAINT "desafios_mobile_usuario_id_usuarios_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuarios"("id");--> statement-breakpoint
ALTER TABLE "envios_pin" ADD CONSTRAINT "envios_pin_usuario_id_usuarios_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuarios"("id");--> statement-breakpoint
ALTER TABLE "refresh_mobile" ADD CONSTRAINT "refresh_mobile_sessao_id_sessoes_mobile_id_fkey" FOREIGN KEY ("sessao_id") REFERENCES "sessoes_mobile"("id");--> statement-breakpoint
ALTER TABLE "sessoes_mobile" ADD CONSTRAINT "sessoes_mobile_usuario_id_usuarios_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuarios"("id");