import type Anthropic from '@anthropic-ai/sdk';
import type { HistoryMessage } from '../kernel/types';
import { ModelResponseError } from '../kernel/errors';
import { asText } from '../kernel/coerce';
import { resolveModel } from '../config/models';
import { normalizeReply } from '../character/reply';
import { completeText, type LlmDeps, type SplitPrompt } from './anthropic';
import { cacheMark, windowStart } from './cache';
import { withReplyQuote } from '../memory/reply-quote';

const HISTORY_LIMIT = 40;
const MAX_TOKENS = 2048;

/**
 * История и реплика собеседника. Каждое сообщение — свой блок: границы блоков
 * не сдвигаются от хода к ходу, и кеш прошлого хода находится по ним. Метка
 * кеша — на последнем блоке истории; новая реплика идёт отдельным блоком.
 */
export function buildMessages(
  history: readonly Partial<HistoryMessage>[],
  userText: string,
): Anthropic.MessageParam[] {
  const out: Array<{
    role: 'user' | 'assistant';
    content: Anthropic.TextBlockParam[];
  }> = [];
  const push = (role: 'user' | 'assistant', text: string) => {
    if (!text) return;
    const last = out[out.length - 1];
    if (last && last.role === role) {
      last.content.push({ type: 'text', text });
      return;
    }
    if (out.length === 0 && role === 'assistant')
      out.push({
        role: 'user',
        content: [{ type: 'text', text: '(начало переписки)' }],
      });
    out.push({ role, content: [{ type: 'text', text }] });
  };
  const recent = history.slice(windowStart(history.length, HISTORY_LIMIT));
  for (const message of recent) {
    push(
      asText(message.role) === 'assistant' ? 'assistant' : 'user',
      withReplyQuote(asText(message.content), message.reply_quote),
    );
  }
  const lastHistory = out[out.length - 1]?.content.at(-1);
  if (lastHistory) Object.assign(lastHistory, cacheMark());
  push('user', userText || '(сообщение без текста)');
  return out;
}

export interface GenerateDraftInput {
  model: string;
  system: SplitPrompt;
  history: readonly Partial<HistoryMessage>[];
  userText: string;
}

export type GenerateDraftDeps = LlmDeps;

export async function generateDraft(
  input: GenerateDraftInput,
  deps: GenerateDraftDeps,
): Promise<string> {
  const text = await completeText(deps, {
    model: resolveModel(input.model),
    system: input.system,
    messages: buildMessages(input.history, input.userText),
    maxTokens: MAX_TOKENS,
    effort: 'off',
    stage: 'generator',
    cacheHistory: true,
  });
  if (!text.trim())
    throw new ModelResponseError('Model returned an empty reply');
  return normalizeReply(text);
}
