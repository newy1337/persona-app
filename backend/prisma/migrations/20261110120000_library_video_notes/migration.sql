-- Кружки в библиотеке образа: тип файла и длительность; старые записи — снимки.
ALTER TABLE "photo_set_photos" ADD COLUMN "kind" TEXT NOT NULL DEFAULT 'photo';
ALTER TABLE "photo_set_photos" ADD COLUMN "duration" INTEGER NOT NULL DEFAULT 0;
