CREATE TABLE "preferencias_notificacao" (
	"usuario_id" uuid PRIMARY KEY,
	"push" boolean DEFAULT false NOT NULL,
	"email" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
ALTER TABLE "notificacoes" ADD COLUMN "lida_at" timestamp;--> statement-breakpoint
ALTER TABLE "preferencias_notificacao" ADD CONSTRAINT "preferencias_notificacao_usuario_id_usuarios_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuarios"("id");