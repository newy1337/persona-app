-- Диктофон: записи звонков из кабинета.
CREATE TABLE "voice_call_recordings" (
  "id" SERIAL NOT NULL,
  "call_id" TEXT NOT NULL,
  "task_id" INTEGER NOT NULL,
  "title" TEXT NOT NULL,
  "file_path" TEXT NOT NULL,
  "duration" INTEGER NOT NULL,
  "created_at" INTEGER NOT NULL,
  "titled_at" INTEGER,
  CONSTRAINT "voice_call_recordings_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "voice_call_recordings_call_id_key" ON "voice_call_recordings"("call_id");
CREATE INDEX "voice_call_recordings_task_id_id_idx" ON "voice_call_recordings"("task_id", "id");
ALTER TABLE "voice_call_recordings" ADD CONSTRAINT "voice_call_recordings_call_id_fkey"
  FOREIGN KEY ("call_id") REFERENCES "voice_calls"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "voice_call_recordings" ADD CONSTRAINT "voice_call_recordings_task_id_fkey"
  FOREIGN KEY ("task_id") REFERENCES "voice_tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;
