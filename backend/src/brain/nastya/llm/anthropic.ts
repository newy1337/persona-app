import { checkCancelled } from 'src/shared/cancellation';
import Anthropic from '@anthropic-ai/sdk';
import type { Logger } from '../kernel/action';
import { ModelResponseError } from '../kernel/errors';
import type { UsageDb } from '../memory/client';
import { recordUsage } from './usage';
import { fillText, variablesNote } from '../config/variables';

export type Effort = 'low' | 'medium' | 'high';

/** Сколько живёт кеш неизменной части промпта. */
export const CACHE_TTL = '1h' as const;

/**
 * A prompt split at its stability boundary.
 *
 * `stable` is byte-identical across chats and turns (rules, persona, catalogs)
 * and carries the cache breakpoint; `volatile` is this turn's state and comes
 * after it. Anything that changes per turn must never leak into `stable` —
 * one changed byte and the whole cache entry is rewritten instead of read.
 */
export interface SplitPrompt {
  stable: string;
  volatile?: string;
}

export interface TextRequest {
  model: string;
  system: SplitPrompt;
  messages: Anthropic.MessageParam[];
  maxTokens: number;
  /** Adaptive thinking at this effort; `off` disables thinking (chat lines, not analysis). */
  effort: Effort | 'off';
  stage: string;
}

export interface LlmDeps {
  signal?: AbortSignal;
  client: Anthropic;
  usageDb: UsageDb;
  logger: Logger;
  /**
   * Переменные диалога (`{city}`, `{site}`): в кешируемом тексте они скобками, значения
   * идут строкой после кеша, а в ответе модели скобки, если проскочат, заменяются.
   */
  variables?: Record<string, string>;
  /** Кто обслужил вызов (`anthropic`, `openrouter`) — для учёта расходов. */
  provider?: string;
}

/**
 * One text completion through the Anthropic API with prompt caching on the
 * stable system block. Returns the concatenated text blocks; a truncated or
 * refused answer is an error, never a half-reply.
 */
export async function completeText(
  deps: LlmDeps,
  req: TextRequest,
): Promise<string> {
  checkCancelled(deps.signal);
  const system: Anthropic.TextBlockParam[] = [
    {
      type: 'text',
      text: req.system.stable,
      cache_control: { type: 'ephemeral', ttl: CACHE_TTL },
    },
  ];
  const vars = deps.variables ?? {};
  const note = variablesNote(
    [
      req.system.stable,
      req.system.volatile ?? '',
      JSON.stringify(req.messages),
    ].join('\n'),
    vars,
  );
  if (note) system.push({ type: 'text', text: note });
  if (req.system.volatile)
    system.push({ type: 'text', text: req.system.volatile });

  const started = performance.now();
  const response = await deps.client.messages.create(
    {
      model: req.model,
      max_tokens: req.maxTokens,
      system,
      messages: req.messages,
      thinking:
        req.effort === 'off' ? { type: 'disabled' } : { type: 'adaptive' },
      ...(req.effort === 'off'
        ? {}
        : { output_config: { effort: req.effort } }),
    },
    deps.signal ? { signal: deps.signal } : undefined,
  );
  await recordUsage(deps.usageDb, deps.logger, response, {
    provider: deps.provider ?? 'anthropic',
    model: req.model,
    stage: req.stage,
    elapsedMs: Math.round(performance.now() - started),
  });

  checkCancelled(deps.signal);
  if (response.stop_reason === 'max_tokens')
    throw new ModelResponseError(`${req.stage}: response was truncated`);
  if (response.stop_reason === 'refusal')
    throw new ModelResponseError(`${req.stage}: model refused`);
  const text = response.content
    .filter((block): block is Anthropic.TextBlock => block.type === 'text')
    .map((block) => block.text)
    .join('');
  return note ? fillText(text, vars) : text;
}
