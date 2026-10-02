CREATE TYPE "status_usuario" AS ENUM('ativo', 'inativo', 'bloqueado');--> statement-breakpoint
CREATE TYPE "tipo_usuario" AS ENUM('admin', 'instituicao', 'gestor', 'medico');--> statement-breakpoint
CREATE TABLE "usuarios" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"nome" varchar(255) NOT NULL,
	"email" varchar(255) NOT NULL UNIQUE,
	"senha_hash" varchar(255) NOT NULL,
	"telefone" varchar(20),
	"tipo" "tipo_usuario" DEFAULT 'medico'::"tipo_usuario",
	"status" "status_usuario" DEFAULT 'ativo'::"status_usuario",
	"ultimo_login_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp
);
