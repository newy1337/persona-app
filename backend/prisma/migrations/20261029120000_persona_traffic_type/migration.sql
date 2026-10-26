-- Тип трафика личности: cold — холодка, hot — горячий; пусто — не проставлен. Ставит админ.
ALTER TABLE "personas" ADD COLUMN "traffic_type" TEXT;
