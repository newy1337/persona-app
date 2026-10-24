-- Ручной откат миграции 20261025120000_channel_accounts (на случай возврата
-- кода на версию до каналов). Возвращает прежние имена; данные не трогает.
--
-- Откатывать можно, только пока в базе нет VK-аккаунтов и VK-чатов: прежняя
-- схема их не понимает (у VK-аккаунта нет номера, у VK-чата chat_id ≠ peer_id).
-- Скрипт проверяет это и прерывается, если они есть.
--
-- Запуск (одной транзакцией):
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -1 -f 20261025120000_channel_accounts.down.sql

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "channel_accounts" WHERE "channel" <> 'telegram')
     OR EXISTS (SELECT 1 FROM "contacts" WHERE "channel" <> 'telegram')
     OR EXISTS (SELECT 1 FROM "leads" WHERE "channel" <> 'telegram') THEN
    RAISE EXCEPTION 'в базе есть не-Telegram аккаунты, чаты или лиды — откат схемы потеряет их смысл';
  END IF;
END $$;

-- 5. Лиды
ALTER TABLE "leads" DROP COLUMN "channel";
ALTER TABLE "leads" RENAME COLUMN "peer_username" TO "telegram_username";
ALTER TABLE "leads" RENAME COLUMN "chat_id" TO "telegram_user_id";
ALTER INDEX "idx_leads_chat" RENAME TO "idx_phone_telegram_user";
ALTER INDEX "idx_leads_status_next" RENAME TO "idx_phone_status_next";
ALTER INDEX "idx_leads_owner_inbound" RENAME TO "idx_phone_owner_inbound";
ALTER INDEX "idx_leads_owner" RENAME TO "idx_phone_owner";
ALTER INDEX "idx_leads_account_contact" RENAME TO "idx_phone_account_contact";
ALTER INDEX "leads_username_key_key" RENAME TO "phone_numbers_username_key_key";
ALTER INDEX "leads_phone_e164_key" RENAME TO "phone_numbers_phone_e164_key";
ALTER SEQUENCE "leads_id_seq" RENAME TO "phone_numbers_id_seq";
ALTER TABLE "leads" RENAME CONSTRAINT "leads_pkey" TO "phone_numbers_pkey";
ALTER TABLE "leads" RENAME TO "phone_numbers";

-- 4. Номер сообщения
ALTER TABLE "photo_sends" RENAME COLUMN "peer_msg_id" TO "tg_msg_id";
ALTER TABLE "messages" RENAME COLUMN "peer_msg_id" TO "tg_msg_id";

-- 3. Чаты
DROP INDEX "contacts_channel_peer_id_key";
ALTER TABLE "contacts" DROP COLUMN "peer_id";
ALTER TABLE "contacts" DROP COLUMN "channel";

-- 2. Менеджеры
ALTER INDEX "manager_accounts_account_id_key" RENAME TO "manager_accounts_tg_account_id_key";
ALTER TABLE "manager_accounts" RENAME CONSTRAINT "manager_accounts_account_id_fkey" TO "manager_accounts_tg_account_id_fkey";
ALTER TABLE "manager_accounts" RENAME COLUMN "account_id" TO "tg_account_id";

-- 1. Аккаунты
ALTER TABLE "channel_accounts" RENAME COLUMN "peer_id" TO "telegram_user_id";
DROP INDEX "idx_channel_accounts_phone";
ALTER TABLE "channel_accounts" ALTER COLUMN "phone_e164" SET NOT NULL;
CREATE UNIQUE INDEX "tg_accounts_phone_e164_key" ON "channel_accounts"("phone_e164");
DROP INDEX "channel_accounts_channel_login_key";
ALTER TABLE "channel_accounts" DROP COLUMN "login";
ALTER TABLE "channel_accounts" DROP COLUMN "channel";
ALTER INDEX "idx_channel_accounts_photo_set" RENAME TO "idx_tg_photo_set";
ALTER INDEX "idx_channel_accounts_persona_status" RENAME TO "idx_tg_persona_status";
ALTER SEQUENCE "channel_accounts_id_seq" RENAME TO "tg_accounts_id_seq";
ALTER TABLE "channel_accounts" RENAME CONSTRAINT "channel_accounts_photo_set_id_fkey" TO "tg_accounts_photo_set_id_fkey";
ALTER TABLE "channel_accounts" RENAME CONSTRAINT "channel_accounts_pkey" TO "tg_accounts_pkey";
ALTER TABLE "channel_accounts" RENAME TO "tg_accounts";

-- Убрать запись о миграции, чтобы прежний код не видел «лишнюю» миграцию.
DELETE FROM "_prisma_migrations" WHERE "migration_name" = '20261025120000_channel_accounts';
