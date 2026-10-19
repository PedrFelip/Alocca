CREATE TYPE "status_plantao" AS ENUM('RASCUNHO', 'ABERTO', 'PREENCHIDO', 'EM_ANDAMENTO', 'CONCLUIDO', 'CANCELADO');--> statement-breakpoint
CREATE TYPE "status_candidatura" AS ENUM('PENDENTE', 'APROVADA', 'REJEITADA', 'CANCELADA');--> statement-breakpoint
CREATE TYPE "origem_alocacao" AS ENUM('CANDIDATURA', 'ATRIBUICAO_DIRETA');--> statement-breakpoint
CREATE TYPE "status_alocacao" AS ENUM('PENDENTE', 'CONFIRMADA', 'CANCELADA', 'CONCLUIDA');--> statement-breakpoint
CREATE TYPE "status_pagamento" AS ENUM('PENDENTE', 'PAGO', 'CANCELADO');--> statement-breakpoint
CREATE TABLE "instituicoes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"usuario_id" uuid NOT NULL,
	"nome" varchar(200) NOT NULL,
	"nome_fantasia" varchar(200),
	"cnpj" varchar(14) NOT NULL UNIQUE,
	"email" varchar(255),
	"telefone" varchar(20),
	"cep" varchar(8),
	"logradouro" varchar(200),
	"numero" varchar(20),
	"complemento" varchar(100),
	"bairro" varchar(100),
	"cidade" varchar(100),
	"uf" char(2),
	"ativa" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "gestores" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"usuario_id" uuid NOT NULL UNIQUE,
	"instituicao_id" uuid NOT NULL,
	"cargo" varchar(100),
	"ativa" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "plantoes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"instituicao_id" uuid NOT NULL,
	"criado_por_gestor_id" uuid NOT NULL,
	"titulo" varchar(150) NOT NULL,
	"descricao" text,
	"especialidade" varchar(100),
	"data_inicio" timestamp NOT NULL,
	"data_fim" timestamp NOT NULL,
	"valor" numeric(10,2) NOT NULL,
	"quantidade_vagas" integer NOT NULL,
	"vagas_disponiveis" integer NOT NULL,
	"status" "status_plantao" DEFAULT 'RASCUNHO'::"status_plantao" NOT NULL,
	"permite_candidatura" boolean DEFAULT true NOT NULL,
	"exige_checkin" boolean DEFAULT true NOT NULL,
	"permite_geolocalizacao" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp,
	CONSTRAINT "plantoes_quantidade_vagas_check" CHECK ("quantidade_vagas" >= 1),
	CONSTRAINT "plantoes_vagas_disponiveis_check" CHECK ("vagas_disponiveis" >= 0 and "vagas_disponiveis" <= "quantidade_vagas"),
	CONSTRAINT "plantoes_periodo_check" CHECK ("data_fim" > "data_inicio")
);
--> statement-breakpoint
CREATE TABLE "candidaturas" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"plantao_id" uuid NOT NULL,
	"medico_id" uuid NOT NULL,
	"status" "status_candidatura" DEFAULT 'PENDENTE'::"status_candidatura" NOT NULL,
	"mensagem_medico" text,
	"observacao_gestor" text,
	"analisado_por_gestor_id" uuid,
	"analisado_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp,
	CONSTRAINT "candidaturas_plantao_medico_unique" UNIQUE("plantao_id","medico_id")
);
--> statement-breakpoint
CREATE TABLE "alocacoes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"plantao_id" uuid NOT NULL,
	"medico_id" uuid NOT NULL,
	"candidatura_id" uuid,
	"atribuido_por_gestor_id" uuid,
	"origem" "origem_alocacao" NOT NULL,
	"status" "status_alocacao" DEFAULT 'PENDENTE'::"status_alocacao" NOT NULL,
	"confirmado_at" timestamp,
	"cancelado_at" timestamp,
	"motivo_cancelamento" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "registros_ponto" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"alocacao_id" uuid NOT NULL CONSTRAINT "registros_ponto_alocacao_unique" UNIQUE,
	"check_in_at" timestamp,
	"check_out_at" timestamp,
	"check_in_latitude" numeric(9,6),
	"check_in_longitude" numeric(9,6),
	"check_out_latitude" numeric(9,6),
	"check_out_longitude" numeric(9,6),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pagamentos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"alocacao_id" uuid NOT NULL CONSTRAINT "pagamentos_alocacao_unique" UNIQUE,
	"valor" numeric(10,2) NOT NULL,
	"status" "status_pagamento" DEFAULT 'PENDENTE'::"status_pagamento" NOT NULL,
	"vencimento_em" timestamp,
	"pago_at" timestamp,
	"observacoes" text,
	"registrado_por_gestor_id" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp
);
--> statement-breakpoint
CREATE INDEX "plantoes_status_candidatura_idx" ON "plantoes" ("status","permite_candidatura");--> statement-breakpoint
CREATE INDEX "plantoes_instituicao_id_idx" ON "plantoes" ("instituicao_id");--> statement-breakpoint
CREATE INDEX "plantoes_data_inicio_idx" ON "plantoes" ("data_inicio");--> statement-breakpoint
CREATE INDEX "plantoes_especialidade_idx" ON "plantoes" ("especialidade");--> statement-breakpoint
CREATE INDEX "candidaturas_plantao_id_idx" ON "candidaturas" ("plantao_id");--> statement-breakpoint
CREATE INDEX "candidaturas_medico_id_idx" ON "candidaturas" ("medico_id");--> statement-breakpoint
CREATE UNIQUE INDEX "alocacoes_candidatura_unique" ON "alocacoes" ("candidatura_id") WHERE "candidatura_id" is not null;--> statement-breakpoint
CREATE INDEX "alocacoes_plantao_id_idx" ON "alocacoes" ("plantao_id");--> statement-breakpoint
CREATE INDEX "alocacoes_medico_id_idx" ON "alocacoes" ("medico_id");--> statement-breakpoint
ALTER TABLE "instituicoes" ADD CONSTRAINT "instituicoes_usuario_id_usuarios_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuarios"("id");--> statement-breakpoint
ALTER TABLE "gestores" ADD CONSTRAINT "gestores_usuario_id_usuarios_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuarios"("id");--> statement-breakpoint
ALTER TABLE "gestores" ADD CONSTRAINT "gestores_instituicao_id_instituicoes_id_fkey" FOREIGN KEY ("instituicao_id") REFERENCES "instituicoes"("id");--> statement-breakpoint
ALTER TABLE "plantoes" ADD CONSTRAINT "plantoes_instituicao_id_instituicoes_id_fkey" FOREIGN KEY ("instituicao_id") REFERENCES "instituicoes"("id");--> statement-breakpoint
ALTER TABLE "plantoes" ADD CONSTRAINT "plantoes_criado_por_gestor_id_gestores_id_fkey" FOREIGN KEY ("criado_por_gestor_id") REFERENCES "gestores"("id");--> statement-breakpoint
ALTER TABLE "candidaturas" ADD CONSTRAINT "candidaturas_plantao_id_plantoes_id_fkey" FOREIGN KEY ("plantao_id") REFERENCES "plantoes"("id");--> statement-breakpoint
ALTER TABLE "candidaturas" ADD CONSTRAINT "candidaturas_medico_id_medicos_id_fkey" FOREIGN KEY ("medico_id") REFERENCES "medicos"("id");--> statement-breakpoint
ALTER TABLE "candidaturas" ADD CONSTRAINT "candidaturas_analisado_por_gestor_id_gestores_id_fkey" FOREIGN KEY ("analisado_por_gestor_id") REFERENCES "gestores"("id");--> statement-breakpoint
ALTER TABLE "alocacoes" ADD CONSTRAINT "alocacoes_plantao_id_plantoes_id_fkey" FOREIGN KEY ("plantao_id") REFERENCES "plantoes"("id");--> statement-breakpoint
ALTER TABLE "alocacoes" ADD CONSTRAINT "alocacoes_medico_id_medicos_id_fkey" FOREIGN KEY ("medico_id") REFERENCES "medicos"("id");--> statement-breakpoint
ALTER TABLE "alocacoes" ADD CONSTRAINT "alocacoes_candidatura_id_candidaturas_id_fkey" FOREIGN KEY ("candidatura_id") REFERENCES "candidaturas"("id");--> statement-breakpoint
ALTER TABLE "alocacoes" ADD CONSTRAINT "alocacoes_atribuido_por_gestor_id_gestores_id_fkey" FOREIGN KEY ("atribuido_por_gestor_id") REFERENCES "gestores"("id");--> statement-breakpoint
ALTER TABLE "registros_ponto" ADD CONSTRAINT "registros_ponto_alocacao_id_alocacoes_id_fkey" FOREIGN KEY ("alocacao_id") REFERENCES "alocacoes"("id");--> statement-breakpoint
ALTER TABLE "pagamentos" ADD CONSTRAINT "pagamentos_alocacao_id_alocacoes_id_fkey" FOREIGN KEY ("alocacao_id") REFERENCES "alocacoes"("id");--> statement-breakpoint
ALTER TABLE "pagamentos" ADD CONSTRAINT "pagamentos_registrado_por_gestor_id_gestores_id_fkey" FOREIGN KEY ("registrado_por_gestor_id") REFERENCES "gestores"("id");