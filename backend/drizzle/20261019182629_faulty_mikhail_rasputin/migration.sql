CREATE TYPE "status_plantao" AS ENUM('ABERTO', 'PREENCHIDO', 'CANCELADO', 'CONCLUIDO');--> statement-breakpoint
CREATE TYPE "status_candidatura" AS ENUM('PENDENTE', 'APROVADA', 'REJEITADA');--> statement-breakpoint
CREATE TYPE "tipo_evento_presenca" AS ENUM('ENTRADA', 'SAIDA');--> statement-breakpoint
CREATE TYPE "status_pagamento" AS ENUM('PENDENTE', 'PAGO');--> statement-breakpoint
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
	"cargo" varchar(100),
	"ativa" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "gestores_instituicoes" (
	"gestor_id" uuid,
	"instituicao_id" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "gestores_instituicoes_pkey" PRIMARY KEY("gestor_id","instituicao_id")
);
--> statement-breakpoint
CREATE TABLE "plantoes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"instituicao_id" uuid NOT NULL,
	"gestor_criador_id" uuid NOT NULL,
	"titulo" varchar(150) NOT NULL,
	"descricao" text,
	"local_unidade" varchar(150) NOT NULL,
	"especialidade" varchar(100) NOT NULL,
	"data_inicio" timestamp NOT NULL,
	"data_fim" timestamp NOT NULL,
	"valor" numeric(10,2) NOT NULL,
	"quantidade_vagas" integer NOT NULL,
	"vagas_disponiveis" integer NOT NULL,
	"status" "status_plantao" DEFAULT 'ABERTO'::"status_plantao" NOT NULL,
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
	CONSTRAINT "candidaturas_plantao_medico_unique" UNIQUE("plantao_id","medico_id"),
	CONSTRAINT "candidaturas_id_plantao_medico_unique" UNIQUE("id","plantao_id","medico_id")
);
--> statement-breakpoint
CREATE TABLE "alocacoes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"plantao_id" uuid NOT NULL,
	"medico_id" uuid NOT NULL,
	"candidatura_id" uuid NOT NULL CONSTRAINT "alocacoes_candidatura_unique" UNIQUE,
	"confirmado_at" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "registros_ponto" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"alocacao_id" uuid NOT NULL,
	"tipo_evento" "tipo_evento_presenca" NOT NULL,
	"timestamp_servidor" timestamp DEFAULT now() NOT NULL,
	"latitude" double precision,
	"longitude" double precision,
	"precisao_metros" double precision,
	"distancia_local" double precision,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "registros_ponto_alocacao_evento_unique" UNIQUE("alocacao_id","tipo_evento")
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
CREATE INDEX "instituicoes_usuario_id_idx" ON "instituicoes" ("usuario_id");--> statement-breakpoint
CREATE INDEX "gestores_instituicoes_instituicao_id_idx" ON "gestores_instituicoes" ("instituicao_id");--> statement-breakpoint
CREATE INDEX "plantoes_feed_idx" ON "plantoes" ("status","data_inicio");--> statement-breakpoint
CREATE INDEX "plantoes_instituicao_id_idx" ON "plantoes" ("instituicao_id");--> statement-breakpoint
CREATE INDEX "plantoes_gestor_criador_id_idx" ON "plantoes" ("gestor_criador_id");--> statement-breakpoint
CREATE INDEX "plantoes_especialidade_idx" ON "plantoes" ("especialidade");--> statement-breakpoint
CREATE INDEX "candidaturas_plantao_id_idx" ON "candidaturas" ("plantao_id");--> statement-breakpoint
CREATE INDEX "candidaturas_medico_id_idx" ON "candidaturas" ("medico_id");--> statement-breakpoint
CREATE INDEX "alocacoes_plantao_id_idx" ON "alocacoes" ("plantao_id");--> statement-breakpoint
CREATE INDEX "alocacoes_medico_id_idx" ON "alocacoes" ("medico_id");--> statement-breakpoint
ALTER TABLE "instituicoes" ADD CONSTRAINT "instituicoes_usuario_id_usuarios_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuarios"("id");--> statement-breakpoint
ALTER TABLE "gestores" ADD CONSTRAINT "gestores_usuario_id_usuarios_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuarios"("id");--> statement-breakpoint
ALTER TABLE "gestores_instituicoes" ADD CONSTRAINT "gestores_instituicoes_gestor_id_gestores_id_fkey" FOREIGN KEY ("gestor_id") REFERENCES "gestores"("id");--> statement-breakpoint
ALTER TABLE "gestores_instituicoes" ADD CONSTRAINT "gestores_instituicoes_instituicao_id_instituicoes_id_fkey" FOREIGN KEY ("instituicao_id") REFERENCES "instituicoes"("id");--> statement-breakpoint
ALTER TABLE "plantoes" ADD CONSTRAINT "plantoes_instituicao_id_instituicoes_id_fkey" FOREIGN KEY ("instituicao_id") REFERENCES "instituicoes"("id");--> statement-breakpoint
ALTER TABLE "plantoes" ADD CONSTRAINT "plantoes_gestor_criador_id_usuarios_id_fkey" FOREIGN KEY ("gestor_criador_id") REFERENCES "usuarios"("id");--> statement-breakpoint
ALTER TABLE "candidaturas" ADD CONSTRAINT "candidaturas_plantao_id_plantoes_id_fkey" FOREIGN KEY ("plantao_id") REFERENCES "plantoes"("id");--> statement-breakpoint
ALTER TABLE "candidaturas" ADD CONSTRAINT "candidaturas_medico_id_medicos_id_fkey" FOREIGN KEY ("medico_id") REFERENCES "medicos"("id");--> statement-breakpoint
ALTER TABLE "candidaturas" ADD CONSTRAINT "candidaturas_analisado_por_gestor_id_gestores_id_fkey" FOREIGN KEY ("analisado_por_gestor_id") REFERENCES "gestores"("id");--> statement-breakpoint
ALTER TABLE "alocacoes" ADD CONSTRAINT "alocacoes_plantao_id_plantoes_id_fkey" FOREIGN KEY ("plantao_id") REFERENCES "plantoes"("id");--> statement-breakpoint
ALTER TABLE "alocacoes" ADD CONSTRAINT "alocacoes_medico_id_medicos_id_fkey" FOREIGN KEY ("medico_id") REFERENCES "medicos"("id");--> statement-breakpoint
ALTER TABLE "alocacoes" ADD CONSTRAINT "alocacoes_candidatura_id_candidaturas_id_fkey" FOREIGN KEY ("candidatura_id") REFERENCES "candidaturas"("id");--> statement-breakpoint
ALTER TABLE "alocacoes" ADD CONSTRAINT "alocacoes_candidatura_vinculo_fkey" FOREIGN KEY ("candidatura_id","plantao_id","medico_id") REFERENCES "candidaturas"("id","plantao_id","medico_id");--> statement-breakpoint
ALTER TABLE "registros_ponto" ADD CONSTRAINT "registros_ponto_alocacao_id_alocacoes_id_fkey" FOREIGN KEY ("alocacao_id") REFERENCES "alocacoes"("id");--> statement-breakpoint
ALTER TABLE "pagamentos" ADD CONSTRAINT "pagamentos_alocacao_id_alocacoes_id_fkey" FOREIGN KEY ("alocacao_id") REFERENCES "alocacoes"("id");--> statement-breakpoint
ALTER TABLE "pagamentos" ADD CONSTRAINT "pagamentos_registrado_por_gestor_id_gestores_id_fkey" FOREIGN KEY ("registrado_por_gestor_id") REFERENCES "gestores"("id");