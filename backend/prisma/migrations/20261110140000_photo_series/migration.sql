-- Серии снимков в образе: бот может отправить серию целиком, альбомом.
CREATE TABLE "photo_series" (
    "id" SERIAL NOT NULL,
    "set_id" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "place" TEXT,
    "taken_on" TEXT,
    "auto_send" BOOLEAN NOT NULL DEFAULT true,
    "created_at" INTEGER NOT NULL,
    "updated_at" INTEGER NOT NULL,
    "deleted_at" INTEGER,
    CONSTRAINT "photo_series_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "idx_photo_series_set" ON "photo_series"("set_id", "deleted_at");
ALTER TABLE "photo_series" ADD CONSTRAINT "photo_series_set_id_fkey" FOREIGN KEY ("set_id") REFERENCES "photo_sets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "photo_set_photos" ADD COLUMN "series_id" INTEGER;
CREATE INDEX "idx_photo_set_photos_series" ON "photo_set_photos"("series_id");
ALTER TABLE "photo_set_photos" ADD CONSTRAINT "photo_set_photos_series_id_fkey" FOREIGN KEY ("series_id") REFERENCES "photo_series"("id") ON DELETE SET NULL ON UPDATE CASCADE;
