-- Руководитель пользователя панели: менеджер → тимлид, тимлид → хед.
ALTER TABLE "dashboard_users" ADD COLUMN "lead_id" INTEGER;
ALTER TABLE "dashboard_users" ADD CONSTRAINT "dashboard_users_lead_id_fkey"
  FOREIGN KEY ("lead_id") REFERENCES "dashboard_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "idx_dashboard_users_lead" ON "dashboard_users"("lead_id");
