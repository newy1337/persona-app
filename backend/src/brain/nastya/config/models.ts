export const GENERATOR_MODEL = 'claude-sonnet-5';
export const OPUS_5 = 'claude-opus-5';
export const OPUS_5_5 = 'claude-opus-5.5';
export const JUDGE_MODEL = OPUS_5;
export const VISION_MODEL = 'claude-sonnet-5';

export const JUDGE_MODELS: readonly string[] = [
  OPUS_5,
  OPUS_5_5,
  GENERATOR_MODEL,
];

export function resolveJudgeModel(value = ''): string {
  const raw = String(value).trim();
  if (!raw) return JUDGE_MODEL;
  const model = raw;
  if (!JUDGE_MODELS.includes(model)) {
    throw new Error(
      `JUDGE_MODEL=${value}: допустимы ${JUDGE_MODELS.join(', ')}`,
    );
  }
  return model;
}

export const MODEL_OPTIONS: ReadonlyArray<
  readonly [id: string, label: string]
> = [
  [GENERATOR_MODEL, 'Claude Sonnet 5'],
  [OPUS_5, 'Claude Opus 5'],
  [OPUS_5_5, 'Claude Opus 5.5'],
];

const MODEL_IDS = new Set(MODEL_OPTIONS.map(([id]) => id));

export function resolveModel(value = ''): string {
  const model = value || GENERATOR_MODEL;
  if (!MODEL_IDS.has(model))
    throw new Error(`Unknown conversation model: ${value}`);
  return model;
}

export const STAGE_LABELS: Readonly<Record<string, string>> = {
  time_location: 'Определение города для местного времени',
  generator: 'Ответ Насти',
  judge_plan: 'Анализ диалога',
  judge_review: 'Проверка ответа',
  judge: 'Судья',
  media_photo: 'Просмотр фото',
  media_reaction: 'Реакция на GIF',
  interlocutor_info: 'Информация про собеседника',
};
