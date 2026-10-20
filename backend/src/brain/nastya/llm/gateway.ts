import type Anthropic from '@anthropic-ai/sdk';
import { checkCancelled } from 'src/shared/cancellation';

/** Метка ответа шлюза: учёт расхода пишет его под провайдером `gateway`. */
export const GATEWAY_ROUTE = 'gateway';

export interface GatewayLog {
  warn(message: string): void;
  log(message: string): void;
}

export interface GatewayOptions {
  log: GatewayLog;
  /** После стольких отказов подряд шлюз на время пропускается. */
  failLimit?: number;
  pauseMs?: number;
  now?: () => number;
}

/** База шлюза: `http://host:3000` и `http://host:3000/v1` — одно и то же. */
export function gatewayBaseUrl(url: string): string {
  const base = url.trim().replace(/\/+$/, '');
  return /\/v1$/.test(base) ? base : `${base}/v1`;
}

/** Каким провайдером записать расход по ответу (шлюз помечает свои). */
export function responseRoute(response: unknown): string | null {
  const route = (response as { provider_route?: unknown } | null)
    ?.provider_route;
  return typeof route === 'string' ? route : null;
}

/**
 * Сначала свой шлюз к Claude, не вышло — тот же запрос в OpenRouter.
 * Ответ шлюза помечается: деньги с OpenRouter за него не списаны, поэтому
 * стоимость в учёте 0. Если шлюз отказал failLimit раз подряд, следующие
 * pauseMs запросы идут сразу в OpenRouter, чтобы не ждать мёртвый шлюз
 * на каждом ответе.
 */
export function withGateway(
  gateway: Anthropic,
  fallback: Anthropic,
  { log, failLimit = 3, pauseMs = 120_000, now = Date.now }: GatewayOptions,
): Anthropic {
  let failures = 0;
  let pausedUntil = 0;

  async function create(
    params: Anthropic.MessageCreateParamsNonStreaming,
    options?: { signal?: AbortSignal },
  ): Promise<Anthropic.Message> {
    if (now() >= pausedUntil) {
      try {
        const response = await gateway.messages.create(params, options);
        if (failures >= failLimit) log.log('шлюз LLM снова отвечает');
        failures = 0;
        const usage = response.usage as unknown as Record<string, unknown>;
        if (usage) usage.openrouter_cost = 0;
        return Object.assign(response, { provider_route: GATEWAY_ROUTE });
      } catch (e) {
        // Отменили сами (чат ушёл в ручной режим) — в OpenRouter не идём.
        checkCancelled(options?.signal);
        failures += 1;
        const reason = (e as Error)?.message ?? String(e);
        if (failures >= failLimit) {
          pausedUntil = now() + pauseMs;
          log.warn(
            `шлюз LLM: ${failures} отказа подряд (${reason}) — ${Math.round(pauseMs / 1000)} с всё идёт в OpenRouter`,
          );
        } else {
          log.warn(`шлюз LLM: ${reason} — запрос ушёл в OpenRouter`);
        }
      }
    }
    return fallback.messages.create(params, options);
  }

  return { messages: { create } } as unknown as Anthropic;
}
