import type { UsageDb } from '../memory/client';

export interface Logger {
  info(message: string, ...rest: unknown[]): void;
  warn(message: string, ...rest: unknown[]): void;
  error(message: string, ...rest: unknown[]): void;
}

export interface UsageRow {
  provider: string;
  model: string;
  stage: string;
  elapsedMs: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  cachedTokens: number | null;
  cacheWriteTokens: number | null;
  cacheWrite1hTokens: number | null;
  providerEstimatedCostUsd: number | null;
}

export interface UsageRecord {
  provider: string;
  model: string;
  stage: string;
  elapsedMs: number;
}

const ANTHROPIC_PRICES: Record<
  string,
  [input: number, output: number, cacheRead: number, cacheWrite: number]
> = {
  'claude-opus-5': [5, 25, 0.5, 6.25],
  'claude-opus-5.5': [4, 20, 0.4, 5],
  'claude-sonnet-5': [2, 10, 0.2, 2.5],
  'claude-sonnet-5.5': [2, 10, 0.2, 2.5],
  'claude-haiku-4-5': [1, 5, 0.1, 1.25],
};

function field(value: any, name: string): unknown {
  return value == null ? undefined : value[name];
}

function count(value: unknown): number | null {
  return typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= 0 &&
    value <= 2 ** 53
    ? value
    : null;
}

export function usageValues(response: unknown, model = '') {
  const usage = field(response, 'usage');
  const uncached = count(field(usage, 'input_tokens'));
  const output = count(field(usage, 'output_tokens'));
  const cacheRead = count(field(usage, 'cache_read_input_tokens')) ?? 0;
  const cacheWrite = count(field(usage, 'cache_creation_input_tokens')) ?? 0;
  const cacheWrite1h = Math.min(
    cacheWrite,
    count(field(field(usage, 'cache_creation'), 'ephemeral_1h_input_tokens')) ??
      0,
  );
  if (uncached == null && output == null) {
    return {
      inputTokens: null,
      outputTokens: null,
      cachedTokens: null,
      cacheWriteTokens: null,
      cacheWrite1hTokens: null,
      providerEstimatedCostUsd: null,
    };
  }
  const price = ANTHROPIC_PRICES[model];
  const billed = field(usage, 'openrouter_cost');
  const cost =
    typeof billed === 'number' && Number.isFinite(billed)
      ? billed
      : price
        ? ((uncached ?? 0) * price[0] +
            (output ?? 0) * price[1] +
            cacheRead * price[2] +
            (cacheWrite - cacheWrite1h) * price[3] +
            cacheWrite1h * price[0] * 2) /
          1_000_000
        : null;
  return {
    inputTokens: (uncached ?? 0) + cacheRead + cacheWrite,
    outputTokens: output ?? 0,
    cachedTokens: cacheRead,
    cacheWriteTokens: cacheWrite,
    cacheWrite1hTokens: cacheWrite1h,
    providerEstimatedCostUsd: cost,
  };
}

let lastWarning = -Infinity;

export async function recordUsage(
  db: UsageDb,
  logger: Logger,
  response: unknown,
  record: UsageRecord,
): Promise<void> {
  try {
    await db.record({
      ...usageValues(response, record.model),
      provider: record.provider,
      model: record.model,
      stage: record.stage,
      elapsedMs: count(record.elapsedMs),
    });
  } catch (error) {
    const now = Date.now();
    if (now - lastWarning >= 60_000) {
      lastWarning = now;
      logger.warn(
        `Model usage recording unavailable (${(error as Error).name})`,
      );
    }
  }
}
