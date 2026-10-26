-- Следующий шаг по лиду: что сделать и когда (напоминание менеджеру).
ALTER TABLE "leads" ADD COLUMN "next_step" TEXT;
ALTER TABLE "leads" ADD COLUMN "next_step_at" INTEGER;
