import type Anthropic from '@anthropic-ai/sdk';
import { cancellableSleep, checkCancelled } from 'src/shared/cancellation';

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
  /**
   * Сколько запросов держать в шлюзе одновременно — его ёмкость (слоты
   * аккаунтов Claude). Лишние ждут свободного слота, а не идут в OpenRouter.
   */
  maxConcurrent?: number;
  /** Сколько запрос ждёт слота или повторяет «занято», прежде чем уйти в OpenRouter. */
  waitMs?: number;
  /** Пауза между повторами, когда шлюз ответил «занято». */
  retryMs?: number;
  now?: () => number;
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
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
 * Шлюз жив, но все слоты заняты (`429 No Agent key has available capacity`)
 * или аккаунт упёрся в лимит окна. Это не поломка: слот освобождается через
 * секунды, поэтому такой отказ не ставит шлюз на паузу.
 */
export function gatewayBusy(e: unknown): boolean {
  const status = (e as { status?: unknown })?.status;
  const text = String((e as Error)?.message ?? e ?? '');
  return status === 429 || /\b429\b|available capacity|rate.?limit/i.test(text);
}

/** Интервал опроса свободного слота. */
const SLOT_POLL_MS = 250;
/** Не чаще раза в минуту пишем, сколько запросов «занятый» шлюз отдал OpenRouter. */
const BUSY_LOG_MS = 60_000;

/**
 * Сначала свой шлюз к Claude, не вышло — тот же запрос в OpenRouter.
 * Ответ шлюза помечается: деньги с OpenRouter за него не списаны, поэтому
 * стоимость в учёте 0.
 *
 * Шлюз бесплатный, но с ограниченной ёмкостью, поэтому:
 * - одновременно в нём не больше maxConcurrent наших запросов, остальные
 *   ждут слота до waitMs;
 * - «занято» (429) — повтор через retryMs, пока не выйдет waitMs;
 * - настоящие отказы (сеть, 5xx, авторизация) failLimit раз подряд ставят
 *   шлюз на паузу pauseMs, чтобы не ждать мёртвый шлюз на каждом ответе.
 */
export function withGateway(
  gateway: Anthropic,
  fallback: Anthropic,
  {
    log,
    failLimit = 3,
    pauseMs = 120_000,
    maxConcurrent = 5,
    waitMs = 15_000,
    retryMs = 1_500,
    now = Date.now,
    sleep = cancellableSleep,
  }: GatewayOptions,
): Anthropic {
  let failures = 0;
  let pausedUntil = 0;
  let active = 0;
  let busyFallbacks = 0;
  let busyLoggedAt = 0;

  function noteBusyFallback(reason: string) {
    busyFallbacks += 1;
    if (now() - busyLoggedAt < BUSY_LOG_MS) return;
    log.warn(
      `шлюз LLM занят (${reason}) — ${busyFallbacks} запрос(ов) ушло в OpenRouter, не дождавшись слота`,
    );
    busyLoggedAt = now();
    busyFallbacks = 0;
  }

  async function viaGateway(
    params: Anthropic.MessageCreateParamsNonStreaming,
    options: { signal?: AbortSignal } | undefined,
    deadline: number,
  ): Promise<Anthropic.Message | null> {
    while (active >= maxConcurrent) {
      if (now() >= deadline) {
        noteBusyFallback(`все ${maxConcurrent} слота наши`);
        return null;
      }
      await sleep(Math.min(SLOT_POLL_MS, deadline - now()), options?.signal);
    }
    active += 1;
    try {
      for (;;) {
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
          const reason = (e as Error)?.message ?? String(e);
          if (gatewayBusy(e)) {
            if (now() + retryMs < deadline) {
              await sleep(retryMs, options?.signal);
              continue;
            }
            noteBusyFallback(reason);
            return null;
          }
          failures += 1;
          if (failures >= failLimit) {
            pausedUntil = now() + pauseMs;
            log.warn(
              `шлюз LLM: ${failures} отказа подряд (${reason}) — ${Math.round(pauseMs / 1000)} с всё идёт в OpenRouter`,
            );
          } else {
            log.warn(`шлюз LLM: ${reason} — запрос ушёл в OpenRouter`);
          }
          return null;
        }
      }
    } finally {
      active -= 1;
    }
  }

  async function create(
    params: Anthropic.MessageCreateParamsNonStreaming,
    options?: { signal?: AbortSignal },
  ): Promise<Anthropic.Message> {
    if (now() >= pausedUntil) {
      const response = await viaGateway(params, options, now() + waitMs);
      if (response) return response;
    }
    return fallback.messages.create(params, options);
  }

  return { messages: { create } } as unknown as Anthropic;
}
