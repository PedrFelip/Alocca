ALTER TABLE "usuarios" ADD COLUMN "email_notificacoes_habilitado" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "notificacoes" ADD COLUMN "lida_em" timestamp;--> statement-breakpoint
ALTER TABLE "notificacoes" ADD COLUMN "tentativas" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "notificacoes" ADD COLUMN "disponivel_em" timestamp DEFAULT now() NOT NULL;