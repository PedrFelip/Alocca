CREATE TYPE "status_notificacao" AS ENUM('PENDENTE', 'ENVIADA');--> statement-breakpoint
CREATE TABLE "notificacoes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"usuario_destino_id" uuid NOT NULL,
	"plantao_id" uuid NOT NULL,
	"tipo" text NOT NULL,
	"status" "status_notificacao" DEFAULT 'PENDENTE'::"status_notificacao" NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"enviada_at" timestamp
);
--> statement-breakpoint
CREATE INDEX "notificacoes_fila_idx" ON "notificacoes" ("status","created_at");--> statement-breakpoint
CREATE INDEX "notificacoes_usuario_destino_id_idx" ON "notificacoes" ("usuario_destino_id");--> statement-breakpoint
ALTER TABLE "notificacoes" ADD CONSTRAINT "notificacoes_usuario_destino_id_usuarios_id_fkey" FOREIGN KEY ("usuario_destino_id") REFERENCES "usuarios"("id");--> statement-breakpoint
ALTER TABLE "notificacoes" ADD CONSTRAINT "notificacoes_plantao_id_plantoes_id_fkey" FOREIGN KEY ("plantao_id") REFERENCES "plantoes"("id");