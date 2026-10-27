ALTER TABLE "usuarios" ADD COLUMN "cpf" varchar(11);--> statement-breakpoint
ALTER TABLE "usuarios" ADD CONSTRAINT "usuarios_cpf_key" UNIQUE("cpf");
