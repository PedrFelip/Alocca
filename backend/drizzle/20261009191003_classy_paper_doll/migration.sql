-- Interrompe a migração se dados legados exigirem uma decisão manual.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM usuarios WHERE tipo IS NULL OR tipo::text = 'instituicao' OR status IS NULL) THEN
    RAISE EXCEPTION 'Revise usuarios com tipo instituicao, tipo nulo ou status nulo antes de migrar';
  END IF;
  IF EXISTS (SELECT 1 FROM usuarios WHERE length(nome) > 150) THEN
    RAISE EXCEPTION 'Revise nomes maiores que 150 caracteres antes de migrar';
  END IF;
END $$;
--> statement-breakpoint
UPDATE usuarios SET email = lower(trim(email));
--> statement-breakpoint
CREATE TABLE "medicos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"usuario_id" uuid NOT NULL UNIQUE,
	"crm" varchar(20) NOT NULL,
	"uf_crm" char(2) NOT NULL,
	"especialidade" varchar(100),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp,
	CONSTRAINT "medicos_crm_uf_crm_unique" UNIQUE("crm","uf_crm")
);
--> statement-breakpoint
CREATE TABLE "tokens_recuperacao_senha" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"usuario_id" uuid NOT NULL,
	"token" varchar(255) NOT NULL UNIQUE,
	"expires_at" timestamp NOT NULL,
	"used_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "usuarios" ALTER COLUMN "status" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "usuarios" ALTER COLUMN "status" DROP DEFAULT;--> statement-breakpoint
DROP TYPE "status_usuario";--> statement-breakpoint
CREATE TYPE "status_usuario" AS ENUM('ATIVO', 'INATIVO', 'BLOQUEADO');--> statement-breakpoint
ALTER TABLE "usuarios" ALTER COLUMN "status" SET DATA TYPE "status_usuario" USING upper("status")::"status_usuario";--> statement-breakpoint
ALTER TABLE "usuarios" ALTER COLUMN "status" SET DEFAULT 'ATIVO'::"status_usuario";--> statement-breakpoint
ALTER TABLE "usuarios" ALTER COLUMN "tipo" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "usuarios" ALTER COLUMN "tipo" DROP DEFAULT;--> statement-breakpoint
DROP TYPE "tipo_usuario";--> statement-breakpoint
CREATE TYPE "tipo_usuario" AS ENUM('MEDICO', 'GESTOR', 'ADMIN');--> statement-breakpoint
ALTER TABLE "usuarios" ALTER COLUMN "tipo" SET DATA TYPE "tipo_usuario" USING upper("tipo")::"tipo_usuario";--> statement-breakpoint
ALTER TABLE "usuarios" ALTER COLUMN "nome" SET DATA TYPE varchar(150) USING "nome"::varchar(150);--> statement-breakpoint
ALTER TABLE "usuarios" ALTER COLUMN "tipo" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "usuarios" ALTER COLUMN "status" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "medicos" ADD CONSTRAINT "medicos_usuario_id_usuarios_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuarios"("id");--> statement-breakpoint
ALTER TABLE "tokens_recuperacao_senha" ADD CONSTRAINT "tokens_recuperacao_senha_usuario_id_usuarios_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuarios"("id");