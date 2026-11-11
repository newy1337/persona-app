-- Модели и рассуждение для конкретного диалога: перекрывают выбор личности; NULL — как у личности.
ALTER TABLE "contacts" ADD COLUMN "generator_model" TEXT;
ALTER TABLE "contacts" ADD COLUMN "judge_model" TEXT;
ALTER TABLE "contacts" ADD COLUMN "generator_effort" TEXT;
ALTER TABLE "contacts" ADD COLUMN "judge_effort" TEXT;
