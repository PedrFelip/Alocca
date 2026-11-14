CREATE TABLE "emails_pendentes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"token_id" uuid NOT NULL,
	"payload" text NOT NULL,
	"tentativas" integer DEFAULT 0 NOT NULL,
	"disponivel_em" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "emails_pendentes_fila_idx" ON "emails_pendentes" ("disponivel_em");--> statement-breakpoint
ALTER TABLE "emails_pendentes" ADD CONSTRAINT "emails_pendentes_token_id_tokens_recuperacao_senha_id_fkey" FOREIGN KEY ("token_id") REFERENCES "tokens_recuperacao_senha"("id") ON DELETE CASCADE;