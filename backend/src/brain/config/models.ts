export const GENERATOR_MODEL = 'claude-sonnet-5';
export const SONNET_5_5 = 'claude-sonnet-5.5';
export const OPUS_5 = 'claude-opus-5';
export const OPUS_5_5 = 'claude-opus-5.5';
export const JUDGE_MODEL = OPUS_5;
export const VISION_MODEL = 'claude-sonnet-5';

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
  [SONNET_5_5, 'Claude Sonnet 5.5'],
  [OPUS_5, 'Claude Opus 5'],
  [OPUS_5_5, 'Claude Opus 5.5'],
  // Не Claude: только через OpenRouter, мимо шлюза (он лишь к Claude).
  ['moonshotai/kimi-k3.1-pro', 'Kimi K3.1 Pro'],
  ['openai/gpt-6-sol', 'GPT-6 Sol'],
  ['openai/gpt-5.6-sol', 'GPT-5.6 Sol'],
  ['moonshotai/kimi-k3', 'Kimi K3'],
  ['z-ai/glm-5.3', 'GLM 5.3'],
  ['google/gemini-3.7-flash', 'Gemini 3.7 Flash'],
  ['google/gemini-4-argon', 'Gemini 4 Argon'],
  ['xiaomi/mimo-v2.6-pro', 'MiMo V2.6 Pro'],
  ['deepseek/deepseek-v4.1-flash-1017', 'DeepSeek V4.1 Flash'],
];

const MODEL_IDS = new Set(MODEL_OPTIONS.map(([id]) => id));

/** Судьи — из того же списка: можно тестировать любые связки. */
export const JUDGE_MODELS: readonly string[] = [...MODEL_IDS];

export function resolveModel(value = ''): string {
  const model = value || GENERATOR_MODEL;
  if (!MODEL_IDS.has(model))
    throw new Error(`Unknown conversation model: ${value}`);
  return model;
}

export const JUDGE_MODEL_OPTIONS: ReadonlyArray<
  readonly [id: string, label: string]
> = MODEL_OPTIONS.filter(([id]) => JUDGE_MODELS.includes(id));

export interface PersonaModels {
  generatorModel?: string | null;
  judgeModel?: string | null;
  generatorEffort?: string | null;
  judgeEffort?: string | null;
}

const MODEL_KEYS = [
  'generatorModel',
  'judgeModel',
  'generatorEffort',
  'judgeEffort',
] as const;

/**
 * Выбор для диалога перекрывает выбор личности — поле за полем: пустое
 * остаётся как у личности.
 */
export function withChatModels<T extends PersonaModels>(
  persona: T,
  chat: PersonaModels | null | undefined,
): T {
  if (!chat || !MODEL_KEYS.some((key) => chat[key])) return persona;
  const out = { ...persona };
  for (const key of MODEL_KEYS) if (chat[key]) out[key] = chat[key];
  return out;
}

export type ReasoningEffort = 'off' | 'low' | 'medium' | 'high';

export const EFFORT_OPTIONS: ReadonlyArray<
  readonly [id: ReasoningEffort, label: string]
> = [
  ['off', 'Без рассуждений'],
  ['low', 'Низкое'],
  ['medium', 'Среднее'],
  ['high', 'Высокое'],
];

/** Ответ личности по умолчанию — без рассуждений (быстро и дёшево). */
export const GENERATOR_EFFORT: ReasoningEffort = 'off';

export function isEffort(value: unknown): value is ReasoningEffort {
  return EFFORT_OPTIONS.some(([id]) => id === value);
}

/** Рассуждение генератора: личность → умолчание из кода. */
export function generatorEffortFor(
  persona: PersonaModels | null | undefined,
): ReasoningEffort {
  const value = persona?.generatorEffort;
  return isEffort(value) ? value : GENERATOR_EFFORT;
}

/** Рассуждение судей: личность → окружение (JUDGE_EFFORT). */
export function judgeEffortFor(
  persona: PersonaModels | null | undefined,
  envValue: ReasoningEffort,
): ReasoningEffort {
  const value = persona?.judgeEffort;
  return isEffort(value) ? value : envValue;
}

/** Модель генератора: личность → окружение → умолчание из кода. */
export function generatorModelFor(
  persona: PersonaModels | null | undefined,
  envValue = '',
): string {
  return resolveModel(persona?.generatorModel || envValue);
}

/** Модель судей: личность → окружение → умолчание из кода. */
export function judgeModelFor(
  persona: PersonaModels | null | undefined,
  envValue = '',
): string {
  return resolveJudgeModel(persona?.judgeModel || envValue);
}

export function isGeneratorModel(value: unknown): value is string {
  return typeof value === 'string' && MODEL_IDS.has(value);
}

export function isJudgeModel(value: unknown): value is string {
  return typeof value === 'string' && JUDGE_MODELS.includes(value);
}

export const STAGE_LABELS: Readonly<Record<string, string>> = {
  time_location: 'Определение города для местного времени',
  generator: 'Ответ личности',
  judge_plan: 'Анализ диалога',
  judge_review: 'Проверка ответа',
  judge: 'Судья',
  persona_memory: 'Память о своих словах',
  media_photo: 'Просмотр фото',
  media_reaction: 'Реакция на GIF',
  interlocutor_info: 'Информация про собеседника',
};

export type ChatModelsPatch = {
  [K in (typeof MODEL_KEYS)[number]]?: string | null;
};

/** Выбор для диалога в ответе API; null — как у личности. */
export function chatModelsView(row: PersonaModels | null | undefined) {
  return {
    generator_model: row?.generatorModel ?? null,
    judge_model: row?.judgeModel ?? null,
    generator_effort: row?.generatorEffort ?? null,
    judge_effort: row?.judgeEffort ?? null,
  };
}
