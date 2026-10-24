-- Каналы: аккаунты, чаты и лиды без «Telegram» в именах — под второй канал (VK).
--
-- Мягкая миграция: только переименования таблиц, колонок, индексов и
-- ограничений плюс новые колонки, заполненные из существующих. Ни одна строка
-- не копируется и не удаляется; RENAME в PostgreSQL меняет только метаданные и
-- проходит мгновенно на любом объёме. Всё в одной транзакции (Prisma оборачивает
-- файл миграции), поэтому при ошибке база остаётся в прежнем виде.
--
-- Откат: prisma/rollback/20261025120000_channel_accounts.down.sql.

-- 1. Аккаунты: tg_accounts → channel_accounts ------------------------------
ALTER TABLE "tg_accounts" RENAME TO "channel_accounts";
ALTER TABLE "channel_accounts" RENAME CONSTRAINT "tg_accounts_pkey" TO "channel_accounts_pkey";
ALTER TABLE "channel_accounts" RENAME CONSTRAINT "tg_accounts_photo_set_id_fkey" TO "channel_accounts_photo_set_id_fkey";
ALTER SEQUENCE "tg_accounts_id_seq" RENAME TO "channel_accounts_id_seq";
ALTER INDEX "idx_tg_persona_status" RENAME TO "idx_channel_accounts_persona_status";
ALTER INDEX "idx_tg_photo_set" RENAME TO "idx_channel_accounts_photo_set";

-- Канал аккаунта; все существующие — Telegram.
ALTER TABLE "channel_accounts" ADD COLUMN "channel" TEXT NOT NULL DEFAULT 'telegram';
-- Логин аккаунта в канале: у Telegram это номер, у VK — логин или idN.
ALTER TABLE "channel_accounts" ADD COLUMN "login" TEXT;
UPDATE "channel_accounts" SET "login" = "phone_e164";
ALTER TABLE "channel_accounts" ALTER COLUMN "login" SET NOT NULL;
CREATE UNIQUE INDEX "channel_accounts_channel_login_key" ON "channel_accounts"("channel", "login");
-- Номер теперь необязателен и уникален только через логин канала.
ALTER TABLE "channel_accounts" ALTER COLUMN "phone_e164" DROP NOT NULL;
DROP INDEX "tg_accounts_phone_e164_key";
CREATE INDEX "idx_channel_accounts_phone" ON "channel_accounts"("phone_e164");
-- id аккаунта в своём канале (был telegram_user_id).
ALTER TABLE "channel_accounts" RENAME COLUMN "telegram_user_id" TO "peer_id";

-- 2. Закрепление аккаунтов за менеджерами ------------------------------------
ALTER TABLE "manager_accounts" RENAME COLUMN "tg_account_id" TO "account_id";
ALTER TABLE "manager_accounts" RENAME CONSTRAINT "manager_accounts_tg_account_id_fkey" TO "manager_accounts_account_id_fkey";
ALTER INDEX "manager_accounts_tg_account_id_key" RENAME TO "manager_accounts_account_id_key";

-- 3. Чаты: канал и id собеседника в канале -----------------------------------
ALTER TABLE "contacts" ADD COLUMN "channel" TEXT NOT NULL DEFAULT 'telegram';
ALTER TABLE "contacts" ADD COLUMN "peer_id" BIGINT;
-- У существующих Telegram-чатов chat_id и есть id собеседника.
UPDATE "contacts" SET "peer_id" = "chat_id";
CREATE UNIQUE INDEX "contacts_channel_peer_id_key" ON "contacts"("channel", "peer_id");

-- 4. Номер сообщения в канале (у Telegram — id сообщения, у VK — cmid) --------
ALTER TABLE "messages" RENAME COLUMN "tg_msg_id" TO "peer_msg_id";
ALTER TABLE "photo_sends" RENAME COLUMN "tg_msg_id" TO "peer_msg_id";

-- 5. Лиды: phone_numbers → leads ----------------------------------------------
ALTER TABLE "phone_numbers" RENAME TO "leads";
ALTER TABLE "leads" RENAME CONSTRAINT "phone_numbers_pkey" TO "leads_pkey";
ALTER SEQUENCE "phone_numbers_id_seq" RENAME TO "leads_id_seq";
ALTER INDEX "phone_numbers_phone_e164_key" RENAME TO "leads_phone_e164_key";
ALTER INDEX "phone_numbers_username_key_key" RENAME TO "leads_username_key_key";
ALTER INDEX "idx_phone_account_contact" RENAME TO "idx_leads_account_contact";
ALTER INDEX "idx_phone_owner" RENAME TO "idx_leads_owner";
ALTER INDEX "idx_phone_owner_inbound" RENAME TO "idx_leads_owner_inbound";
ALTER INDEX "idx_phone_status_next" RENAME TO "idx_leads_status_next";
ALTER INDEX "idx_phone_telegram_user" RENAME TO "idx_leads_chat";
-- Чат лида (был telegram_user_id) и ник в канале.
ALTER TABLE "leads" RENAME COLUMN "telegram_user_id" TO "chat_id";
ALTER TABLE "leads" RENAME COLUMN "telegram_username" TO "peer_username";
-- Канал, в который писать лиду; все существующие — Telegram.
ALTER TABLE "leads" ADD COLUMN "channel" TEXT NOT NULL DEFAULT 'telegram';
