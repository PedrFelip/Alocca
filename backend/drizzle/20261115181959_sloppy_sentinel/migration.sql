CREATE TABLE "dispositivos_confiaveis" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"usuario_id" uuid NOT NULL,
	"token_hash" varchar(64) NOT NULL,
	"versao_sessao" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "desafios_mobile" ADD COLUMN "dispositivo_hash" varchar(64);--> statement-breakpoint
CREATE INDEX "dispositivos_confiaveis_usuario_token_idx" ON "dispositivos_confiaveis" ("usuario_id","token_hash");--> statement-breakpoint
ALTER TABLE "dispositivos_confiaveis" ADD CONSTRAINT "dispositivos_confiaveis_usuario_id_usuarios_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuarios"("id");