import { FUNNEL_STAGES, DEAL_STAGE_LABELS } from 'src/domain/deal-stage';
import { cacheWrite1hExtra, costOf, type ModelPrice } from './prices';

/** Токены одной модели, сложенные по нескольким вызовам. */
export interface ModelTokens {
  model: string;
  input: number;
  output: number;
  cache_write: number;
  cache_read: number;
  cache_write_1h: number;
}

/** Цена суммы токенов: формула линейна, так что сумма по вызовам — сумма цен. */
export function costOfSums(
  rows: ModelTokens[],
  price: (model: string) => ModelPrice | null,
): number {
  let total = 0;
  for (const r of rows) {
    const p = price(r.model);
    total +=
      costOf(p, {
        input: r.input,
        output: r.output,
        cache_write: r.cache_write,
        cache_read: r.cache_read,
      }) + cacheWrite1hExtra(p, r.cache_write_1h);
  }
  return total;
}

/** Вызов модели в чате: момент и цена. */
export interface PricedCall {
  at: number;
  cost: number;
}

export interface StageCost {
  stage: string;
  label: string;
  reached_at: number | null;
  /** сколько стоил диалог к моменту, когда ему поставили этап */
  cost_usd: number | null;
  /** сколько добавилось с прошлого пройденного этапа */
  delta_usd: number | null;
}

const usd = (x: number): number => Math.round(x * 1e6) / 1e6;

/**
 * Цена диалога сейчас и на каждом этапе сделки. Этап без отметки времени
 * (не пройден или пройден до того, как время начали записывать) — пустой.
 */
export function dialogCost(
  calls: PricedCall[],
  reached: Record<string, unknown>,
): { total_usd: number; calls: number; stages: StageCost[] } {
  const sorted = [...calls].sort((a, b) => a.at - b.at);
  const upTo = (ts: number) => {
    let sum = 0;
    for (const c of sorted) {
      if (c.at > ts) break;
      sum += c.cost;
    }
    return sum;
  };
  let previous: number | null = null;
  const stages = FUNNEL_STAGES.map((stage) => {
    const ts = Number(reached?.[stage]);
    if (!Number.isFinite(ts) || ts <= 0)
      return {
        stage,
        label: DEAL_STAGE_LABELS[stage],
        reached_at: null,
        cost_usd: null,
        delta_usd: null,
      };
    const cost = upTo(ts);
    const delta = previous === null ? cost : Math.max(0, cost - previous);
    previous = cost;
    return {
      stage,
      label: DEAL_STAGE_LABELS[stage],
      reached_at: ts,
      cost_usd: usd(cost),
      delta_usd: usd(delta),
    };
  });
  return {
    total_usd: usd(sorted.reduce((n, c) => n + c.cost, 0)),
    calls: sorted.length,
    stages,
  };
}

/** Средняя и медианная цена диалога к этапу по чатам, дошедшим до него. */
export function stageCostSummary(
  perChat: Array<{ stage: string; cost: number }>,
): Array<{
  stage: string;
  label: string;
  chats: number;
  avg_usd: number | null;
  median_usd: number | null;
  total_usd: number;
}> {
  return FUNNEL_STAGES.map((stage) => {
    const costs = perChat
      .filter((r) => r.stage === stage)
      .map((r) => r.cost)
      .sort((a, b) => a - b);
    const total = costs.reduce((n, c) => n + c, 0);
    const mid = Math.floor(costs.length / 2);
    const median = !costs.length
      ? null
      : costs.length % 2
        ? costs[mid]!
        : (costs[mid - 1]! + costs[mid]!) / 2;
    return {
      stage,
      label: DEAL_STAGE_LABELS[stage],
      chats: costs.length,
      avg_usd: costs.length ? usd(total / costs.length) : null,
      median_usd: median === null ? null : usd(median),
      total_usd: usd(total),
    };
  });
}
