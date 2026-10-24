-- Распределение входящих лидов: онлайн, суточный лимит и источники у пользователя.
ALTER TABLE "dashboard_users" ADD COLUMN "online" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "dashboard_users" ADD COLUMN "lead_quota" INTEGER;
ALTER TABLE "dashboard_users" ADD COLUMN "lead_sources" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "dashboard_users" ADD COLUMN "lead_personas" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

-- Доноры: откуда приходят лиды; менеджер принимает лиды своих доноров.
CREATE TABLE "donors" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "created_at" INTEGER NOT NULL,
    CONSTRAINT "donors_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "donors_name_key" ON "donors"("name");

CREATE TABLE "manager_donors" (
    "user_id" INTEGER NOT NULL,
    "donor_id" INTEGER NOT NULL,
    CONSTRAINT "manager_donors_pkey" PRIMARY KEY ("user_id", "donor_id"),
    CONSTRAINT "manager_donors_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "dashboard_users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "manager_donors_donor_id_fkey" FOREIGN KEY ("donor_id") REFERENCES "donors"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "idx_manager_donors_donor" ON "manager_donors"("donor_id");

-- Поля входящего лида по API.
ALTER TABLE "phone_numbers" ADD COLUMN "donor" TEXT;
ALTER TABLE "phone_numbers" ADD COLUMN "account_label" TEXT;
ALTER TABLE "phone_numbers" ADD COLUMN "external_id" TEXT;
ALTER TABLE "phone_numbers" ADD COLUMN "profile_url" TEXT;
ALTER TABLE "phone_numbers" ADD COLUMN "last_messages" TEXT;
ALTER TABLE "phone_numbers" ADD COLUMN "inbound_at" INTEGER;
ALTER TABLE "phone_numbers" ADD COLUMN "requested_region" TEXT;
ALTER TABLE "phone_numbers" ADD COLUMN "requested_persona" TEXT;
CREATE INDEX "idx_phone_owner_inbound" ON "phone_numbers"("owner_user_id", "inbound_at");

-- Ключи для внешних систем: хеш, имя, отзыв.
CREATE TABLE "api_keys" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "key_hash" TEXT NOT NULL,
    "prefix" TEXT NOT NULL,
    "created_at" INTEGER NOT NULL,
    "created_by_id" INTEGER,
    "last_used_at" INTEGER,
    "revoked_at" INTEGER,
    CONSTRAINT "api_keys_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "api_keys_key_hash_key" ON "api_keys"("key_hash");

-- Справочник источников лидов.
CREATE TABLE "lead_source_catalog" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "created_at" INTEGER NOT NULL,
    CONSTRAINT "lead_source_catalog_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "lead_source_catalog_name_key" ON "lead_source_catalog"("name");
