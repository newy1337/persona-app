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
  /**
   * Сколько слотов у шлюза сейчас (сумма по готовым ключам, см.
   * watchGatewayCapacity). Предел — меньшее из этого и maxConcurrent;
   * null — шлюз о себе не сообщил, держимся maxConcurrent.
   */
  capacity?: () => number | null;
  /**
   * Таймаут или обрыв связи — признак перегрузки, а не смерти шлюза: пока
   * шлюз за это время хоть раз ответил, такие отказы не ставят его на паузу.
   */
  aliveMs?: number;
  /**
   * Чат, чей запрос ушёл в OpenRouter, столько остаётся там: кеш истории
   * у каждого маршрута свой, и чат, прыгающий между ними, платит за запись
   * кеша в OpenRouter, а читает его уже шлюз.
   */
  stickyMs?: number;
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

/** Запрос не дождался ответа или соединение оборвалось — так шлюз ведёт себя под перегрузкой. */
export function gatewayTransient(e: unknown): boolean {
  const status = (e as { status?: unknown })?.status;
  const text = String((e as Error)?.message ?? e ?? '');
  return (
    status === 408 ||
    /нет ответа за|ECONNRESET|UND_ERR_SOCKET|socket hang up|other side closed/i.test(
      text,
    )
  );
}

/**
 * Шлюз сам добавляет метки кеша к нашим, и вместе их бывает больше
 * допустимых четырёх (`400 A maximum of 4 blocks with cache_control`).
 */
export function cacheLimitError(e: unknown): boolean {
  return /maximum of \d+ blocks with cache_control/i.test(
    String((e as Error)?.message ?? e ?? ''),
  );
}

type CacheMarked = { cache_control?: unknown };

/** Тот же запрос, но метка кеша только на последнем размеченном блоке. */
export function lastCacheMarkOnly(
  params: Anthropic.MessageCreateParamsNonStreaming,
): Anthropic.MessageCreateParamsNonStreaming {
  const system = Array.isArray(params.system)
    ? params.system.map((b) => ({ ...b }))
    : params.system;
  const messages = params.messages.map((m) => ({
    ...m,
    content:
      typeof m.content === 'string'
        ? m.content
        : m.content.map((b) => ({ ...b })),
  }));
  const marked: CacheMarked[] = [];
  if (Array.isArray(system)) marked.push(...(system as CacheMarked[]));
  for (const m of messages)
    if (Array.isArray(m.content)) marked.push(...(m.content as CacheMarked[]));
  const withMark = marked.filter((b) => b.cache_control);
  for (const b of withMark.slice(0, -1)) delete b.cache_control;
  return {
    ...params,
    system,
    messages,
  } as Anthropic.MessageCreateParamsNonStreaming;
}

interface GatewayKey {
  enabled?: unknown;
  status?: unknown;
  max_concurrent?: unknown;
}

/** Слоты шлюза: сумма max_concurrent по включённым и готовым ключам. */
export function gatewaySlots(keys: readonly GatewayKey[]): number {
  let slots = 0;
  for (const key of keys)
    if (key.enabled !== false && key.status === 'ready')
      slots += Math.max(0, Number(key.max_concurrent) || 0);
  return slots;
}

export interface CapacityWatch {
  current(): number | null;
  stop(): void;
}

/**
 * Раз в intervalMs спрашивает у шлюза его ключи (`/dashboard/api/keys`)
 * и помнит, сколько у готовых слотов. Ключи уходят на паузу по лимиту
 * подписки и возвращаются, поэтому ёмкость не постоянная. Не ответил —
 * остаётся прошлое значение.
 */
export function watchGatewayCapacity({
  url,
  apiKey,
  log,
  intervalMs = 60_000,
  fetch: doFetch = fetch,
}: {
  url: string;
  apiKey: string;
  log: GatewayLog;
  intervalMs?: number;
  fetch?: typeof fetch;
}): CapacityWatch {
  const root = gatewayBaseUrl(url).replace(/\/v1$/, '');
  let slots: number | null = null;
  let warned = false;
  async function poll() {
    try {
      const res = await doFetch(`${root}/dashboard/api/keys`, {
        headers: { authorization: `Bearer ${apiKey}` },
        signal: AbortSignal.timeout(10_000),
      });
      const json: unknown = await res.json();
      const keys = Array.isArray(json)
        ? json
        : ((json as { data?: unknown; keys?: unknown })?.data ??
          (json as { keys?: unknown })?.keys);
      if (!res.ok || !Array.isArray(keys))
        throw new Error(`HTTP ${res.status}`);
      const next = gatewaySlots(keys as GatewayKey[]);
      if (next !== slots) log.log(`шлюз LLM: готовых слотов ${next}`);
      slots = next;
      warned = false;
    } catch (e) {
      if (!warned)
        log.warn(
          `шлюз LLM: не узнать ёмкость (${(e as Error)?.message ?? e}) — держимся прежней`,
        );
      warned = true;
    }
  }
  void poll();
  const timer = setInterval(() => void poll(), intervalMs);
  timer.unref?.();
  return {
    current: () => slots,
    stop: () => clearInterval(timer),
  };
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
 * - одновременно в нём не больше наших запросов, чем слотов у его готовых
 *   ключей (и не больше maxConcurrent), остальные ждут слота до waitMs;
 * - «занято» (429) — повтор через retryMs, пока не выйдет waitMs;
 * - лишняя метка кеша — повтор с одной меткой;
 * - таймаут и обрыв связи у отвечающего шлюза — только этот запрос в OpenRouter;
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
    stickyMs = 15 * 60_000,
    capacity = () => null,
    aliveMs = 60_000,
    now = Date.now,
    sleep = cancellableSleep,
  }: GatewayOptions,
): Anthropic {
  let failures = 0;
  let pausedUntil = 0;
  let answeredAt = -Infinity;
  let active = 0;
  let busyFallbacks = 0;
  let busyLoggedAt = 0;
  /** Чат → до какого времени его запросы идут сразу в OpenRouter. */
  const sticky = new Map<string, number>();

  function stick(key: string | undefined) {
    if (!key || stickyMs <= 0) return;
    if (sticky.size > 10_000)
      for (const [k, until] of sticky) if (until <= now()) sticky.delete(k);
    sticky.set(key, now() + stickyMs);
  }

  function stuck(key: string | undefined): boolean {
    if (!key) return false;
    const until = sticky.get(key);
    if (until === undefined) return false;
    if (until > now()) return true;
    sticky.delete(key);
    return false;
  }

  function noteBusyFallback(reason: string) {
    busyFallbacks += 1;
    if (now() - busyLoggedAt < BUSY_LOG_MS) return;
    log.warn(
      `шлюз LLM занят (${reason}) — ${busyFallbacks} запрос(ов) ушло в OpenRouter, не дождавшись слота`,
    );
    busyLoggedAt = now();
    busyFallbacks = 0;
  }

  function limit(): number {
    const slots = capacity();
    return slots === null ? maxConcurrent : Math.min(maxConcurrent, slots);
  }

  async function viaGateway(
    params: Anthropic.MessageCreateParamsNonStreaming,
    options: { signal?: AbortSignal } | undefined,
    deadline: number,
  ): Promise<Anthropic.Message | null> {
    if (limit() <= 0) {
      noteBusyFallback('все ключи шлюза на паузе');
      return null;
    }
    while (active >= limit()) {
      if (now() >= deadline) {
        noteBusyFallback(`все ${limit()} слота наши`);
        return null;
      }
      await sleep(Math.min(SLOT_POLL_MS, deadline - now()), options?.signal);
    }
    active += 1;
    let request = params;
    try {
      for (;;) {
        try {
          const response = await gateway.messages.create(request, options);
          if (failures >= failLimit) log.log('шлюз LLM снова отвечает');
          failures = 0;
          answeredAt = now();
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
          if (cacheLimitError(e) && request === params) {
            request = lastCacheMarkOnly(params);
            continue;
          }
          if (gatewayTransient(e) && now() - answeredAt < aliveMs) {
            log.warn(`шлюз LLM: ${reason} — запрос ушёл в OpenRouter`);
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
    options?: { signal?: AbortSignal; routeKey?: string },
  ): Promise<Anthropic.Message> {
    const { routeKey, ...rest } = options ?? {};
    const sendOptions = options ? rest : undefined;
    if (now() >= pausedUntil && !stuck(routeKey)) {
      const response = await viaGateway(params, sendOptions, now() + waitMs);
      if (response) return response;
      stick(routeKey);
    }
    return fallback.messages.create(params, sendOptions);
  }

  return { messages: { create } } as unknown as Anthropic;
}

/** Без шлюза ключ маршрута не нужен — до клиента модели он не доходит. */
export function withoutRouteKey(client: Anthropic): Anthropic {
  return {
    messages: {
      create: (
        params: Anthropic.MessageCreateParamsNonStreaming,
        options?: { signal?: AbortSignal; routeKey?: string },
      ) => {
        const { routeKey: _routeKey, ...rest } = options ?? {};
        return client.messages.create(params, options ? rest : undefined);
      },
    },
  } as unknown as Anthropic;
}
