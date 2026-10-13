-- Первое сообщение лиду, написанное менеджером вручную; пусто — шаблон личности.
ALTER TABLE "phone_numbers" ADD COLUMN IF NOT EXISTS "first_message" TEXT;
