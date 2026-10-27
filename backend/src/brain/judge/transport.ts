import type { HistoryMessage } from '../kernel/types';
import { ModelResponseError } from '../kernel/errors';
import { resolveJudgeModel } from '../config/models';
import type Anthropic from '@anthropic-ai/sdk';
import { cacheMark, windowStart } from '../llm/cache';
import {
  completeText,
  type Effort,
  type LlmDeps,
  type SplitPrompt,
} from '../llm/anthropic';

export interface JudgeDeps extends LlmDeps {
  effort?: Effort;
  model?: string;
}

/**
 * Последние сообщения для судьи. Окно сдвигается блоками по step, а не на
 * каждое сообщение: так начало истории совпадает с прошлым ходом и читается
 * из кеша (от limit до limit+step-1 сообщений).
 */
export function judgeHistory(
  history: readonly Partial<HistoryMessage>[],
  limit: number,
  step = 10,
): Array<Record<string, unknown>> {
  return history.slice(windowStart(history.length, limit, step)).map((item) => {
    const { id: _id, ...rest } = item as Record<string, unknown>;
    return rest;
  });
}

export function recordReferences(
  records: readonly Record<string, unknown>[],
  catalog: readonly Record<string, unknown>[],
): Array<Record<string, unknown>> {
  const byId = new Map(
    catalog.filter((item) => item['id']).map((item) => [item['id'], item]),
  );
  return records.map((item) => {
    const twin = byId.get(item['id']);
    return item['id'] && twin && JSON.stringify(item) === JSON.stringify(twin)
      ? { id: item['id'] }
      : { ...item };
  });
}

export function parseJsonObject(text: string): Record<string, any> {
  const trimmed = text.trim();
  let value: unknown;
  try {
    value = JSON.parse(trimmed);
  } catch {
    const start = trimmed.indexOf('{');
    const end = trimmed.lastIndexOf('}');
    if (start < 0 || end <= start)
      throw new ModelResponseError('Judge returned invalid JSON');
    value = JSON.parse(trimmed.slice(start, end + 1));
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ModelResponseError('Judge response must be an object');
  }
  return value as Record<string, any>;
}

export async function judgeResponseText(
  deps: JudgeDeps,
  system: SplitPrompt,
  payload: unknown,
  maxTokens: number,
  stage: string,
): Promise<string> {
  return completeText(deps, {
    model: deps.model ?? resolveJudgeModel(),
    system,
    messages: [{ role: 'user', content: judgePayloadBlocks(payload) }],
    maxTokens,
    effort: deps.effort ?? 'low',
    stage,
    cacheHistory: true,
  });
}

/**
 * Вход судьи блоками: recent_history — по сообщению в блоке, от старых к
 * новым, с меткой кеша на последнем; остальное (состояние диалога, новое
 * сообщение) — одним JSON после истории. Границы блоков истории те же, что
 * на прошлом ходе, — по ним находится кеш, платится только новое.
 */
export function judgePayloadBlocks(
  payload: unknown,
): Anthropic.TextBlockParam[] {
  const { recent_history: history, ...rest } = (payload ?? {}) as Record<
    string,
    unknown
  >;
  if (!Array.isArray(history) || !history.length)
    return [{ type: 'text', text: JSON.stringify(payload) }];
  const blocks: Anthropic.TextBlockParam[] = [
    {
      type: 'text',
      text: 'recent_history — последние сообщения диалога, по одному JSON в блоке, от старых к новым:',
    },
    ...history.map((item) => ({
      type: 'text' as const,
      text: JSON.stringify(item),
    })),
  ];
  Object.assign(blocks[blocks.length - 1], cacheMark());
  blocks.push({ type: 'text', text: JSON.stringify(rest) });
  return blocks;
}
