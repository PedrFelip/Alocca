CREATE INDEX "desafios_mobile_usuario_idx" ON "desafios_mobile" ("usuario_id");--> statement-breakpoint
CREATE INDEX "desafios_mobile_expira_idx" ON "desafios_mobile" ("expires_at");--> statement-breakpoint
CREATE INDEX "envios_pin_usuario_data_idx" ON "envios_pin" ("usuario_id","created_at");--> statement-breakpoint
CREATE INDEX "envios_pin_data_idx" ON "envios_pin" ("created_at");--> statement-breakpoint
CREATE INDEX "refresh_mobile_sessao_idx" ON "refresh_mobile" ("sessao_id");--> statement-breakpoint
CREATE INDEX "sessoes_mobile_usuario_idx" ON "sessoes_mobile" ("usuario_id");--> statement-breakpoint
CREATE INDEX "sessoes_mobile_expira_idx" ON "sessoes_mobile" ("expires_at");