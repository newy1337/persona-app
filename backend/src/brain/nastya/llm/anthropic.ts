import { checkCancelled } from 'src/shared/cancellation';
import Anthropic from '@anthropic-ai/sdk';
import type { Logger } from '../kernel/action';
import { ModelResponseError } from '../kernel/errors';
import type { UsageDb } from '../memory/client';
import { recordUsage } from './usage';
import { fillText, variablesNote } from '../config/variables';

export type Effort = 'low' | 'medium' | 'high';

export const CACHE_TTL = '1h' as const;

export interface SplitPrompt {
  stable: string;
  volatile?: string;
}

export interface TextRequest {
  model: string;
  system: SplitPrompt;
  messages: Anthropic.MessageParam[];
  maxTokens: number;
  effort: Effort | 'off';
  stage: string;
}

export interface LlmDeps {
  signal?: AbortSignal;
  client: Anthropic;
  usageDb: UsageDb;
  logger: Logger;
  variables?: Record<string, string>;
  provider?: string;
}

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
