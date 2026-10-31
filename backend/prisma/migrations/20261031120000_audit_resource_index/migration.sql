-- История чата ищет журнал действий по объекту (chat:<id>, lead:<id>).
CREATE INDEX "idx_dashboard_audit_resource" ON "dashboard_audit_log"("resource", "id");
