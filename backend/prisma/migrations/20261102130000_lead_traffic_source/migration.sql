-- Источник трафика лида: базовик, горячий или холодный лидген.
ALTER TABLE "leads" ADD COLUMN "traffic_source" TEXT;
-- Холодка всегда холодный лидген; про остальных старых лидов источник неизвестен.
UPDATE "leads" SET "traffic_source" = 'cold_leadgen' WHERE "cold";
CREATE INDEX "idx_leads_traffic_source" ON "leads"("traffic_source", "inserted_at");
