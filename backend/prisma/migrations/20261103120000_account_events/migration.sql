-- Журнал аккаунтов: добавлен и слетел — для статистики по командам и менеджерам.
CREATE TABLE "account_events" (
    "id" SERIAL NOT NULL,
    "account_id" INTEGER NOT NULL,
    "channel" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "status" TEXT,
    "reason" TEXT,
    "manager_id" INTEGER,
    "chats" INTEGER NOT NULL DEFAULT 0,
    "ts" INTEGER NOT NULL,
    CONSTRAINT "account_events_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "idx_account_events_ts" ON "account_events"("ts");
CREATE INDEX "idx_account_events_manager" ON "account_events"("manager_id", "ts");

-- Что известно на сегодня: живые аккаунты — когда добавлены и чьи сейчас;
-- слетевшие — когда слетели и сколько диалогов на них. Удалённые раньше не восстановить.
INSERT INTO "account_events" ("account_id", "channel", "kind", "manager_id", "ts")
SELECT a."id", a."channel", 'added', ma."user_id", a."added_at"
FROM "channel_accounts" a LEFT JOIN "manager_accounts" ma ON ma."account_id" = a."id";

INSERT INTO "account_events" ("account_id", "channel", "kind", "status", "reason", "manager_id", "chats", "ts")
SELECT a."id", a."channel", 'lost', a."status", a."ban_reason", ma."user_id",
  (SELECT count(*) FROM "contacts" c WHERE c."account_id" = a."id"), a."banned_at"
FROM "channel_accounts" a LEFT JOIN "manager_accounts" ma ON ma."account_id" = a."id"
WHERE a."status" IN ('banned', 'unauthorized') AND a."banned_at" IS NOT NULL;
