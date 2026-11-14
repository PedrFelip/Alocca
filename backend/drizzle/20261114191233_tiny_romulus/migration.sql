CREATE TABLE "sessoes_auth" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"usuario_id" uuid NOT NULL,
	"token_hash" varchar(64) NOT NULL UNIQUE,
	"expires_at" timestamp with time zone NOT NULL,
	"revogado_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "sessoes_auth_usuario_id_idx" ON "sessoes_auth" ("usuario_id");--> statement-breakpoint
ALTER TABLE "sessoes_auth" ADD CONSTRAINT "sessoes_auth_usuario_id_usuarios_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuarios"("id");