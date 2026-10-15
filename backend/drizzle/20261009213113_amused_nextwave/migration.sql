CREATE TYPE "status_validacao_medico" AS ENUM('PENDENTE', 'APROVADO', 'REJEITADO');--> statement-breakpoint
ALTER TABLE "medicos" ADD COLUMN "status_validacao" "status_validacao_medico" DEFAULT 'PENDENTE'::"status_validacao_medico" NOT NULL;--> statement-breakpoint
ALTER TABLE "medicos" ADD COLUMN "validado_por_usuario_id" uuid;--> statement-breakpoint
ALTER TABLE "medicos" ADD COLUMN "validado_at" timestamp;--> statement-breakpoint
ALTER TABLE "medicos" ADD COLUMN "motivo_rejeicao" varchar(500);--> statement-breakpoint
ALTER TABLE "medicos" ADD CONSTRAINT "medicos_validado_por_usuario_id_usuarios_id_fkey" FOREIGN KEY ("validado_por_usuario_id") REFERENCES "usuarios"("id");