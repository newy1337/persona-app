import { checkCancelled, cancellableSleep } from 'src/shared/cancellation';
import type Anthropic from '@anthropic-ai/sdk';

/**
 * Claude через OpenRouter с интерфейсом SDK Anthropic.
 *
 * Движок, судьи, генератор и разбор фото зовут `client.messages.create(...)` в формате
 * Messages API. Этот клиент принимает тот же запрос, переводит его в формат
 * OpenRouter (`/chat/completions`) и возвращает ответ в форме Anthropic — вместе
 * с учётом токенов кеша. Поэтому переключение провайдера не трогает ни промпты,
 * ни разбор ответов, ни статистику.
 *
 * Что сохраняется:
 *  · кеш промпта — `cache_control` (в том числе `ttl: "1h"`) OpenRouter передаёт Claude как есть;
 *  · думание — `thinking` + `output_config.effort` → `reasoning.effort`;
 *  · картинки — base64-блок → `image_url` с data URL;
 *  · один провайдер (по умолчанию Anthropic): у Bedrock/Vertex свой кеш, и прыжки
 *    между ними превращали бы каждое чтение кеша в дорогую запись.
 */

export interface OpenRouterOptions {
  apiKey: string;
  baseUrl?: string;
  /** Провайдеры по порядку; пусто — OpenRouter выбирает сам (кеш будет промахиваться). */
  providers?: string[];
  timeoutMs?: number;
  maxRetries?: number;
  /** Для рейтинга приложений OpenRouter: необязательно. */
  referer?: string;
  title?: string;
  fetch?: typeof fetch;
}

type Params = Anthropic.MessageCreateParamsNonStreaming & {
  output_config?: { effort?: string };
};

interface ChatPart {
  type: 'text' | 'image_url';
  text?: string;
  image_url?: { url: string };
  cache_control?: unknown;
}

export class OpenRouterError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'OpenRouterError';
  }
}

/** `claude-sonnet-5` → `anthropic/claude-sonnet-5`; уже с префиксом — как есть. */
export function openRouterModel(model: string): string {
  return model.includes('/') ? model : `anthropic/${model}`;
}

function textPart(block: { text: string; cache_control?: unknown }): ChatPart {
  return {
    type: 'text',
    text: block.text,
    ...(block.cache_control ? { cache_control: block.cache_control } : {}),
  };
}

function convertContent(
  content: Anthropic.MessageParam['content'],
): string | ChatPart[] {
  if (typeof content === 'string') return content;
  const parts: ChatPart[] = [];
  for (const block of content) {
    if (block.type === 'text')
      parts.push(textPart(block as Anthropic.TextBlockParam));
    else if (block.type === 'image' && block.source.type === 'base64') {
      parts.push({
        type: 'image_url',
        image_url: {
          url: `data:${block.source.media_type};base64,${block.source.data}`,
        },
      });
    } else {
      throw new Error(
        `OpenRouter: блок «${block.type}» не поддерживается переходником`,
      );
    }
  }
  return parts;
}

/** Запрос Messages API → тело `/chat/completions` OpenRouter. */
export function toOpenRouterBody(
  params: Params,
  providers: string[] = [],
): Record<string, unknown> {
  const messages: Array<{ role: string; content: string | ChatPart[] }> = [];
  if (typeof params.system === 'string') {
    if (params.system)
      messages.push({ role: 'system', content: params.system });
  } else if (Array.isArray(params.system) && params.system.length) {
    messages.push({
      role: 'system',
      content: params.system.map((b) => textPart(b)),
    });
  }
  for (const m of params.messages)
    messages.push({ role: m.role, content: convertContent(m.content) });

  const thinking = params.thinking as { type?: string } | undefined;
  const effort = params.output_config?.effort;
  const reasoning =
    thinking?.type === 'disabled'
      ? { enabled: false }
      : { ...(effort ? { effort } : { enabled: true }), exclude: true };

  return {
    model: openRouterModel(params.model),
    max_tokens: params.max_tokens,
    messages,
    reasoning,
    ...(providers.length
      ? { provider: { order: providers, allow_fallbacks: false } }
      : {}),
  };
}

const STOP_REASON: Record<string, Anthropic.Message['stop_reason']> = {
  stop: 'end_turn',
  length: 'max_tokens',
  content_filter: 'refusal',
  tool_calls: 'tool_use',
};

/** Ответ OpenRouter → форма `Anthropic.Message`, которую читают движок и учёт расходов. */
export function fromOpenRouterResponse(
  json: any,
  params: Params,
): Anthropic.Message {
  const choice = json?.choices?.[0] ?? {};
  const raw = choice?.message?.content;
  const text =
    typeof raw === 'string'
      ? raw
      : Array.isArray(raw)
        ? raw.map((p: any) => p?.text ?? '').join('')
        : '';
  const native = String(choice?.native_finish_reason ?? '');
  const stop =
    native === 'refusal'
      ? 'refusal'
      : (STOP_REASON[String(choice?.finish_reason ?? 'stop')] ?? 'end_turn');

  const usage = json?.usage ?? {};
  const prompt = Number(usage.prompt_tokens ?? 0) || 0;
  const cached = Number(usage.prompt_tokens_details?.cached_tokens ?? 0) || 0;
  const written =
    Number(usage.prompt_tokens_details?.cache_write_tokens ?? 0) || 0;
  const hourCache = JSON.stringify(params.system ?? '').includes('"ttl":"1h"');

  return {
    id: String(json?.id ?? ''),
    type: 'message',
    role: 'assistant',
    model: String(json?.model ?? params.model),
    content: [{ type: 'text', text, citations: null } as Anthropic.TextBlock],
    stop_reason: stop,
    stop_sequence: null,
    usage: {
      input_tokens: Math.max(0, prompt - cached - written),
      output_tokens: Number(usage.completion_tokens ?? 0) || 0,
      cache_read_input_tokens: cached,
      cache_creation_input_tokens: written,
      cache_creation: {
        ephemeral_1h_input_tokens: hourCache ? written : 0,
        ephemeral_5m_input_tokens: hourCache ? 0 : written,
      },
      openrouter_cost: typeof usage.cost === 'number' ? usage.cost : null,
    } as unknown as Anthropic.Usage,
  } as Anthropic.Message;
}

/** Клиент с `messages.create` как у `new Anthropic()`: подставляется вместо него. */
export function createOpenRouterClient(options: OpenRouterOptions): Anthropic {
  const baseUrl = (options.baseUrl || 'https://openrouter.ai/api/v1').replace(
    /\/+$/,
    '',
  );
  const doFetch = options.fetch ?? fetch;
  const timeoutMs = options.timeoutMs ?? 180_000;
  const maxRetries = options.maxRetries ?? 2;

  async function create(
    params: Params,
    requestOptions?: { signal?: AbortSignal },
  ): Promise<Anthropic.Message> {
    const signal = requestOptions?.signal;
    checkCancelled(signal);
    const body = JSON.stringify(
      toOpenRouterBody(params, options.providers ?? []),
    );
    for (let attempt = 0; ; attempt += 1) {
      checkCancelled(signal);
      const controller = new AbortController();
      const abort = () => controller.abort(signal?.reason);
      signal?.addEventListener('abort', abort, { once: true });
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const res = await doFetch(`${baseUrl}/chat/completions`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${options.apiKey}`,
            ...(options.referer ? { 'http-referer': options.referer } : {}),
            ...(options.title ? { 'x-title': options.title } : {}),
          },
          body,
          signal: controller.signal,
        });
        const json: any = await res.json().catch(() => null);
        checkCancelled(signal);
        const error = json?.error;
        if (!res.ok || error) {
          const status = Number(error?.code) || res.status;
          const message = `OpenRouter ${status}: ${error?.message ?? res.statusText ?? 'ошибка'}`;
          if ((status === 429 || status >= 500) && attempt < maxRetries) {
            await cancellableSleep(1000 * 2 ** attempt, signal);
            continue;
          }
          throw new OpenRouterError(status, message);
        }
        return fromOpenRouterResponse(json, params);
      } catch (e) {
        checkCancelled(signal);
        if (e instanceof OpenRouterError) throw e;
        const aborted = (e as Error)?.name === 'AbortError';
        if (attempt < maxRetries) {
          await cancellableSleep(1000 * 2 ** attempt, signal);
          continue;
        }
        if (aborted)
          throw new OpenRouterError(
            408,
            `OpenRouter: нет ответа за ${Math.round(timeoutMs / 1000)} с`,
          );
        const cause = (e as { cause?: { code?: string; message?: string } })
          ?.cause;
        throw new OpenRouterError(
          503,
          `OpenRouter: нет связи (${cause?.code ?? cause?.message ?? (e as Error)?.message ?? e})`,
        );
      } finally {
        clearTimeout(timer);
        signal?.removeEventListener('abort', abort);
      }
    }
  }

  return { messages: { create } } as unknown as Anthropic;
}
