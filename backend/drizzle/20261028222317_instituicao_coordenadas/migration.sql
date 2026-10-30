ALTER TABLE "instituicoes" ADD COLUMN "latitude" double precision;--> statement-breakpoint
ALTER TABLE "instituicoes" ADD COLUMN "longitude" double precision;--> statement-breakpoint
ALTER TABLE "instituicoes" ADD CONSTRAINT "instituicoes_coordenadas_check" CHECK (("latitude" is null) = ("longitude" is null));--> statement-breakpoint
ALTER TABLE "instituicoes" ADD CONSTRAINT "instituicoes_latitude_check" CHECK ("latitude" between -90 and 90);--> statement-breakpoint
ALTER TABLE "instituicoes" ADD CONSTRAINT "instituicoes_longitude_check" CHECK ("longitude" between -180 and 180);