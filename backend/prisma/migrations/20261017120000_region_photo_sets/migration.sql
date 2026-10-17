-- Образы по регионам: образ принадлежит региону хеда, хед назначает его
-- личностям региона, а диалог закрепляется за образом, на котором начался.
ALTER TABLE "photo_sets" ADD COLUMN "region_code" TEXT;
CREATE INDEX "idx_photo_sets_region" ON "photo_sets"("region_code");

CREATE TABLE "region_photo_sets" (
    "region_code" TEXT NOT NULL,
    "persona_slug" TEXT NOT NULL,
    "set_id" INTEGER NOT NULL,
    "updated_at" INTEGER NOT NULL,
    "updated_by" INTEGER,
    CONSTRAINT "region_photo_sets_pkey" PRIMARY KEY ("region_code", "persona_slug"),
    CONSTRAINT "region_photo_sets_set_id_fkey" FOREIGN KEY ("set_id") REFERENCES "photo_sets"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "idx_region_photo_sets_set" ON "region_photo_sets"("set_id");

CREATE TABLE "region_stops" (
    "region_code" TEXT NOT NULL,
    "reason" TEXT,
    "actor_id" INTEGER,
    "created_at" INTEGER NOT NULL,
    CONSTRAINT "region_stops_pkey" PRIMARY KEY ("region_code")
);

ALTER TABLE "contacts"
  ADD COLUMN "photo_set_id" INTEGER,
  ADD CONSTRAINT "contacts_photo_set_id_fkey" FOREIGN KEY ("photo_set_id") REFERENCES "photo_sets"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "idx_contacts_photo_set" ON "contacts"("photo_set_id");

-- Начатые диалоги остаются на образе, который сейчас стоит на их аккаунте.
UPDATE "contacts" c SET "photo_set_id" = a."photo_set_id"
  FROM "tg_accounts" a
  WHERE c."account_id" = a."id" AND a."photo_set_id" IS NOT NULL;

-- Общих образов больше нет: образ переходит региону, где на нём больше всего
-- аккаунтов. Образ, который ни на одном аккаунте не стоит, остаётся без
-- региона — его видит только администратор и может перевести в регион.
UPDATE "photo_sets" s SET "region_code" = r."region_code"
  FROM (
    SELECT DISTINCT ON (a."photo_set_id") a."photo_set_id" AS set_id, u."region_code"
      FROM "tg_accounts" a
      JOIN "manager_accounts" ma ON ma."tg_account_id" = a."id"
      JOIN "dashboard_users" u ON u."id" = ma."user_id"
     WHERE a."photo_set_id" IS NOT NULL AND u."region_code" IS NOT NULL
     GROUP BY a."photo_set_id", u."region_code"
     ORDER BY a."photo_set_id", COUNT(*) DESC, u."region_code"
  ) r
  WHERE s."id" = r.set_id;

-- Текущее назначение по аккаунтам становится назначением личности в регионе:
-- берётся образ этого региона, стоящий на большинстве аккаунтов личности.
-- Начатые диалоги уже закреплены за своим образом выше и его не теряют.
INSERT INTO "region_photo_sets" ("region_code", "persona_slug", "set_id", "updated_at")
SELECT DISTINCT ON (u."region_code", a."persona_id")
       u."region_code", a."persona_id", a."photo_set_id",
       CAST(EXTRACT(EPOCH FROM NOW()) AS INTEGER)
  FROM "tg_accounts" a
  JOIN "manager_accounts" ma ON ma."tg_account_id" = a."id"
  JOIN "dashboard_users" u ON u."id" = ma."user_id"
  JOIN "photo_sets" s ON s."id" = a."photo_set_id"
   AND s."archived_at" IS NULL AND s."region_code" = u."region_code"
 WHERE a."photo_set_id" IS NOT NULL
 GROUP BY u."region_code", a."persona_id", a."photo_set_id"
 ORDER BY u."region_code", a."persona_id", COUNT(*) DESC, a."photo_set_id";
