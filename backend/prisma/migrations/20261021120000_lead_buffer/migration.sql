-- Буфер входящих лидов (только ник, без телефона) и перезабив.
ALTER TABLE "phone_numbers" ADD COLUMN "reassigned" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "phone_numbers" ADD COLUMN "buffered_at" INTEGER;

-- Отклонённые из буфера: лид удаляется, слепок остаётся.
CREATE TABLE "declined_leads" (
    "id" SERIAL NOT NULL,
    "phone_e164" TEXT,
    "username_key" TEXT,
    "region_code" TEXT,
    "snapshot" TEXT NOT NULL,
    "reason" TEXT,
    "declined_at" INTEGER NOT NULL,
    "declined_by_id" INTEGER,
    CONSTRAINT "declined_leads_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "idx_declined_leads_username" ON "declined_leads"("username_key");
CREATE INDEX "idx_declined_leads_phone" ON "declined_leads"("phone_e164");

-- Настройки региона: принимать ли перезабив. Нет строки — не принимать.
CREATE TABLE "region_settings" (
    "region_code" TEXT NOT NULL,
    "accept_reassigned" BOOLEAN NOT NULL DEFAULT false,
    "updated_at" INTEGER NOT NULL,
    "updated_by_id" INTEGER,
    CONSTRAINT "region_settings_pkey" PRIMARY KEY ("region_code")
);
