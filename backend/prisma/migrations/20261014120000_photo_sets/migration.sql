-- Образы: общие библиотеки фото, которые бот и менеджер отправляют в диалогах.
CREATE TABLE "photo_sets" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "cover_photo_id" INTEGER,
    "auto_send" BOOLEAN NOT NULL DEFAULT true,
    "send_mode" TEXT NOT NULL DEFAULT 'initiative',
    "min_interval_min" INTEGER NOT NULL DEFAULT 120,
    "max_per_day" INTEGER NOT NULL DEFAULT 2,
    "no_repeat" BOOLEAN NOT NULL DEFAULT true,
    "archived_at" INTEGER,
    "created_at" INTEGER NOT NULL,
    "updated_at" INTEGER NOT NULL,
    CONSTRAINT "photo_sets_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "photo_set_photos" (
    "id" SERIAL NOT NULL,
    "set_id" INTEGER NOT NULL,
    "file_path" TEXT NOT NULL,
    "thumb_path" TEXT NOT NULL,
    "sha256" TEXT NOT NULL,
    "width" INTEGER NOT NULL DEFAULT 0,
    "height" INTEGER NOT NULL DEFAULT 0,
    "description" TEXT NOT NULL DEFAULT '',
    "place" TEXT,
    "taken_on" TEXT,
    "details" TEXT NOT NULL DEFAULT '',
    "tags" TEXT NOT NULL DEFAULT '[]',
    "auto_send" BOOLEAN NOT NULL DEFAULT true,
    "reviewed" BOOLEAN NOT NULL DEFAULT false,
    "created_at" INTEGER NOT NULL,
    "updated_at" INTEGER NOT NULL,
    "deleted_at" INTEGER,
    CONSTRAINT "photo_set_photos_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "photo_set_photos_set_id_fkey" FOREIGN KEY ("set_id") REFERENCES "photo_sets"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "uq_photo_set_sha" ON "photo_set_photos"("set_id", "sha256");
CREATE INDEX "idx_photo_set_photos" ON "photo_set_photos"("set_id", "deleted_at");

CREATE TABLE "photo_sends" (
    "id" SERIAL NOT NULL,
    "chat_id" BIGINT NOT NULL,
    "photo_id" INTEGER NOT NULL,
    "account_id" INTEGER,
    "message_id" INTEGER,
    "tg_msg_id" INTEGER,
    "caption" TEXT NOT NULL DEFAULT '',
    "note" TEXT NOT NULL DEFAULT '',
    "source" TEXT NOT NULL,
    "actor" TEXT,
    "sent_at" INTEGER NOT NULL,
    CONSTRAINT "photo_sends_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "photo_sends_photo_id_fkey" FOREIGN KEY ("photo_id") REFERENCES "photo_set_photos"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "photo_sends_message_id_key" ON "photo_sends"("message_id");
CREATE INDEX "idx_photo_sends_chat" ON "photo_sends"("chat_id", "sent_at");
CREATE INDEX "idx_photo_sends_photo" ON "photo_sends"("photo_id");

ALTER TABLE "tg_accounts"
  ADD COLUMN "photo_set_id" INTEGER,
  ADD COLUMN "photo_auto_send" BOOLEAN NOT NULL DEFAULT true,
  ADD CONSTRAINT "tg_accounts_photo_set_id_fkey" FOREIGN KEY ("photo_set_id") REFERENCES "photo_sets"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "idx_tg_photo_set" ON "tg_accounts"("photo_set_id");

ALTER TABLE "dashboard_users" ADD COLUMN "can_edit_photo_sets" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "messages" ADD COLUMN "media_note" TEXT;
ALTER TABLE "pending_replies" ADD COLUMN "photo_id" INTEGER;
