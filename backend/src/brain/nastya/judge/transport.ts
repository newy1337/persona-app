import type { HistoryMessage } from '../kernel/types';
import { ModelResponseError } from '../kernel/errors';
import { resolveJudgeModel } from '../config/models';
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

export function judgeHistory(
  history: readonly Partial<HistoryMessage>[],
  limit: number,
): Array<Record<string, unknown>> {
  return history.slice(-limit).map((item) => {
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
    messages: [{ role: 'user', content: JSON.stringify(payload) }],
    maxTokens,
    effort: deps.effort ?? 'low',
    stage,
  });
}
