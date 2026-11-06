-- Уровень рассуждения у личности: отдельно для ответа и для судей; NULL — по умолчанию.
ALTER TABLE "personas" ADD COLUMN "generator_effort" TEXT;
ALTER TABLE "personas" ADD COLUMN "judge_effort" TEXT;
