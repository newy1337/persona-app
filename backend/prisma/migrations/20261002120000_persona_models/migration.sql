-- Модель генератора и судей на личность; NULL — значение из окружения.
ALTER TABLE "personas"
  ADD COLUMN "generator_model" TEXT,
  ADD COLUMN "judge_model" TEXT;
