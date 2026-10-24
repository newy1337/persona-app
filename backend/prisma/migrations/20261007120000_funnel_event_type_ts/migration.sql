-- Статистика читает события по типу и времени; без индекса это полный скан таблицы.
CREATE INDEX IF NOT EXISTS "idx_funnel_type_ts" ON "funnel_events" ("event_type", "ts");
