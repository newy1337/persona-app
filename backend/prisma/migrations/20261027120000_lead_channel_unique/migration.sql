-- Один номер или ник может быть лидом и в Telegram, и в VK: уникальность — внутри канала.
DROP INDEX "leads_phone_e164_key";
DROP INDEX "leads_username_key_key";
CREATE UNIQUE INDEX "leads_channel_phone_key" ON "leads"("channel", "phone_e164");
CREATE UNIQUE INDEX "leads_channel_username_key" ON "leads"("channel", "username_key");
