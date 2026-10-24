import type Anthropic from '@anthropic-ai/sdk';
import type { HistoryMessage } from '../kernel/types';
import { ModelResponseError } from '../kernel/errors';
import { asText } from '../kernel/coerce';
import { resolveModel } from '../config/models';
import { normalizeReply } from '../character/reply';
import { completeText, type LlmDeps, type SplitPrompt } from './anthropic';

const HISTORY_LIMIT = 40;
const MAX_TOKENS = 2048;

export function buildMessages(
  history: readonly Partial<HistoryMessage>[],
  userText: string,
): Anthropic.MessageParam[] {
  const out: Anthropic.MessageParam[] = [];
  const push = (role: 'user' | 'assistant', text: string) => {
    if (!text) return;
    const last = out[out.length - 1];
    if (last && last.role === role) {
      last.content = `${last.content as string}\n${text}`;
      return;
    }
    if (out.length === 0 && role === 'assistant')
      out.push({ role: 'user', content: '(начало переписки)' });
    out.push({ role, content: text });
  };
  for (const message of history.slice(-HISTORY_LIMIT)) {
    push(
      asText(message.role) === 'assistant' ? 'assistant' : 'user',
      asText(message.content),
    );
  }
  push('user', userText);
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
  });
  if (!text.trim())
    throw new ModelResponseError('Model returned an empty reply');
  return normalizeReply(text);
}
