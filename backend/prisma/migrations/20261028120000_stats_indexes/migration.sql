-- Срезы статистики и журнал: диапазон по времени без полного перебора таблиц.
CREATE INDEX IF NOT EXISTS "idx_messages_ts_role" ON "messages"("ts", "role");
CREATE INDEX IF NOT EXISTS "idx_model_usage_chat" ON "model_usage"("chat_id");
CREATE INDEX IF NOT EXISTS "idx_leads_first_contact" ON "leads"("first_contact_at");
CREATE INDEX IF NOT EXISTS "idx_dashboard_audit_user_id" ON "dashboard_audit_log"("user_id", "id");
CREATE INDEX IF NOT EXISTS "idx_dashboard_audit_action_id" ON "dashboard_audit_log"("action", "id");
