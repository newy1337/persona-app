-- Опрос необработанных входящих шёл по всему messages (сотни тысяч строк на
-- каждый тик): обработанных подавляющее большинство. Частичный индекс держит
-- только ожидающие разбора.
CREATE INDEX IF NOT EXISTS "idx_messages_inbound_pending" ON "messages" ("id")
  WHERE "processed_at" IS NULL AND "deleted_at" IS NULL AND "inbound_payload" IS NOT NULL;
