-- Удаление учётки из панели — мягкое: строка остаётся для статистики.
ALTER TABLE "dashboard_users" ADD COLUMN "deleted_at" INTEGER;
