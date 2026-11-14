CREATE TABLE "desafios_mobile" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"usuario_id" uuid NOT NULL,
	"token_hash" varchar(64) NOT NULL UNIQUE,
	"pin_hash" varchar(64),
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
ALTER TABLE "desafios_mobile" ADD CONSTRAINT "desafios_mobile_usuario_id_usuarios_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuarios"("id");--> statement-breakpoint
ALTER TABLE "envios_pin" ADD CONSTRAINT "envios_pin_usuario_id_usuarios_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuarios"("id");--> statement-breakpoint
ALTER TABLE "refresh_mobile" ADD CONSTRAINT "refresh_mobile_sessao_id_sessoes_mobile_id_fkey" FOREIGN KEY ("sessao_id") REFERENCES "sessoes_mobile"("id");--> statement-breakpoint
ALTER TABLE "sessoes_mobile" ADD CONSTRAINT "sessoes_mobile_usuario_id_usuarios_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuarios"("id");