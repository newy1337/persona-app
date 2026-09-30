export const PRICES_KEY = 'prices';

const MODEL_NAME = /^[a-z0-9.\-/]{3,64}$/;
const FAMILY_NAME = /^[a-z0-9-]{2,32}$/;

const MAX_MODELS = 100;
const MAX_FAMILIES = 20;
const MAX_PRICE = 100_000;
const MAX_NOTE = 500;

export const PRICE_FIELDS = [
  'input',
  'output',
  'cache_write',
  'cache_read',
] as const;
export type PriceField = (typeof PRICE_FIELDS)[number];

export type ModelPrice = Record<PriceField, number>;
export type Tokens = Record<PriceField, number>;

export interface PriceTable {
  currency: 'USD';
  models: Record<string, ModelPrice>;
  families: Record<string, string>;
  note: string | null;
  is_default?: boolean;
}

export const DEFAULT_PRICES: PriceTable = {
  currency: 'USD',
  models: {
    'claude-opus-5': {
      input: 5,
      output: 25,
      cache_write: 6.25,
      cache_read: 0.5,
    },
    'claude-opus-5.5': {
      input: 4,
      output: 20,
      cache_write: 5,
      cache_read: 0.4,
    },
    'claude-sonnet-5': {
      input: 2,
      output: 10,
      cache_write: 2.5,
      cache_read: 0.2,
    },
    'claude-haiku-4-5': {
      input: 1,
      output: 5,
      cache_write: 1.25,
      cache_read: 0.1,
    },
    'gpt-4o-mini-transcribe': {
      input: 3,
      output: 5,
      cache_write: 0,
      cache_read: 0,
    },
  },
  families: {
    'opus-5.5': 'claude-opus-5.5',
    opus: 'claude-opus-5',
    sonnet: 'claude-sonnet-5',
    haiku: 'claude-haiku-4-5',
  },
  note: 'Прайс-лист Anthropic; «запись кеша» — пятиминутная (×1,25 от входа), часовая считается как ×2 от входа, чтение ×0,1. Сверьте с актуальным прайс-листом.',
};

export const ZERO_TOKENS = (): Tokens => ({
  input: 0,
  output: 0,
  cache_write: 0,
  cache_read: 0,
});

export const normalizeModel = (model: string): string =>
  String(model ?? '').replace(/^[^/]+\//, '');

export function resolvePrice(
  table: PriceTable,
  model: string,
): ModelPrice | null {
  if (Object.prototype.hasOwnProperty.call(table.models, model))
    return table.models[model];
  const lower = model.toLowerCase();
  for (const [family, target] of Object.entries(table.families)) {
    if (
      lower.includes(family.toLowerCase()) &&
      Object.prototype.hasOwnProperty.call(table.models, target)
    ) {
      return table.models[target];
    }
  }
  return null;
}

export function cacheWrite1hExtra(
  price: ModelPrice | null,
  tokens1h: number,
): number {
  if (!price || !tokens1h) return 0;
  return (tokens1h * (2 * price.input - price.cache_write)) / 1e6;
}

export function costOf(price: ModelPrice | null, t: Tokens): number {
  if (!price) return 0;
  return (
    (t.input * price.input +
      t.output * price.output +
      t.cache_write * price.cache_write +
      t.cache_read * price.cache_read) /
    1e6
  );
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

function asPrice(v: unknown, field: string): number {
  const n =
    typeof v === 'string' && v.trim() ? Number(v.trim().replace(',', '.')) : v;
  if (typeof n !== 'number' || !Number.isFinite(n) || n < 0 || n > MAX_PRICE) {
    throw new Error(
      `${field}: число от 0 до ${MAX_PRICE} (USD за 1 млн токенов)`,
    );
  }
  return n;
}

export function parseTable(
  raw: unknown,
  fallbackFamilies: Record<string, string>,
): PriceTable {
  if (!isRecord(raw)) throw new Error('таблица цен должна быть объектом');
  if (!isRecord(raw.models))
    throw new Error('models: нужен словарь «модель → цены»');

  const names = Object.keys(raw.models);
  if (!names.length) throw new Error('models: нужна хотя бы одна модель');
  if (names.length > MAX_MODELS)
    throw new Error(`models: не больше ${MAX_MODELS} моделей`);

  const models: Record<string, ModelPrice> = {};
  for (const name of names) {
    if (!MODEL_NAME.test(name)) {
      throw new Error(
        `«${name}»: имя модели — латиница, цифры, точка, дефис; 3–64 символа`,
      );
    }
    const entry = raw.models[name];
    if (!isRecord(entry))
      throw new Error(
        `${name}: цены — объект {input, output, cache_write, cache_read}`,
      );
    const price = {} as ModelPrice;
    for (const f of PRICE_FIELDS) price[f] = asPrice(entry[f], `${name}.${f}`);
    models[name] = price;
  }

  const families: Record<string, string> = {};
  if (raw.families === undefined || raw.families === null) {
    for (const [family, target] of Object.entries(fallbackFamilies)) {
      if (Object.prototype.hasOwnProperty.call(models, target))
        families[family] = target;
    }
  } else {
    if (!isRecord(raw.families))
      throw new Error('families: нужен словарь «семейство → модель»');
    const entries = Object.entries(raw.families);
    if (entries.length > MAX_FAMILIES)
      throw new Error(`families: не больше ${MAX_FAMILIES} семейств`);
    for (const [family, target] of entries) {
      if (!FAMILY_NAME.test(family))
        throw new Error(
          `families: «${family}» — латиница, цифры, дефис; 2–32 символа`,
        );
      if (
        typeof target !== 'string' ||
        !Object.prototype.hasOwnProperty.call(models, target)
      ) {
        throw new Error(
          `families: «${family}» ссылается на модель, которой нет в таблице`,
        );
      }
      families[family] = target;
    }
  }

  let note: string | null = null;
  if (raw.note !== undefined && raw.note !== null) {
    if (typeof raw.note !== 'string') throw new Error('note: строка');
    note = raw.note.trim().slice(0, MAX_NOTE) || null;
  }

  return { currency: 'USD', models, families, note };
}
