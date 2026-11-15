ALTER TABLE "instituicoes" ADD COLUMN "cache_revisao" uuid DEFAULT gen_random_uuid() NOT NULL;
--> statement-breakpoint
CREATE FUNCTION renovar_cache_revisao_instituicao() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.cache_revisao := gen_random_uuid();
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER instituicoes_cache_revisao_update
BEFORE UPDATE ON instituicoes
FOR EACH ROW EXECUTE FUNCTION renovar_cache_revisao_instituicao();
