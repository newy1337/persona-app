-- Удаление записи из библиотеки: строка остаётся ради истории отправок, файл стирается.
ALTER TABLE "voice_recordings" ADD COLUMN "deleted_at" INTEGER;
ALTER TABLE "voice_call_recordings" ADD COLUMN "deleted_at" INTEGER;
