-- Образы назначаются учётке: строка — пара «сотрудник + образ», личность
-- сотрудник выбирает сам и у каждой личности один действующий образ.
-- Прежняя строка «сотрудник + личность + образ» — это уже привязанный образ;
-- если один образ стоял на двух личностях, оставляем последнюю привязку.
DELETE FROM "manager_photo_sets" a
USING "manager_photo_sets" b
WHERE a."user_id" = b."user_id"
  AND a."set_id" = b."set_id"
  AND (a."updated_at" < b."updated_at"
       OR (a."updated_at" = b."updated_at" AND a."persona_slug" > b."persona_slug"));

ALTER TABLE "manager_photo_sets" DROP CONSTRAINT "manager_photo_sets_pkey";
ALTER TABLE "manager_photo_sets" ALTER COLUMN "persona_slug" DROP NOT NULL;
ALTER TABLE "manager_photo_sets" ADD CONSTRAINT "manager_photo_sets_pkey" PRIMARY KEY ("user_id", "set_id");
-- одна личность — один действующий образ; образов в запасе (NULL) сколько угодно
CREATE UNIQUE INDEX "manager_photo_sets_user_persona_key" ON "manager_photo_sets"("user_id", "persona_slug");
