import {
  TOKEN_CODES,
  VkApiError,
  VkCaptcha,
  VkFlood,
  VkIpMismatch,
  VkTokenDead,
  classify,
} from './errors';
import type { VkHttp } from './http';
import { fetchWithRetry, type VkToken } from './session';

/** Официальный хост: веб-токен он принимает (Chutter, замер 16.09). */
export const API_HOST = 'api.vk.com';
/** Версия, на которой проверялся веб-клиент VK. */
export const API_VERSION = '5.444';
/**
 * Темп на аккаунт. Замер на веб-токене: 1 запрос/с — всё проходит, 2.86/с —
 * капча через ~4 запроса. Документация обещает 3/с — на веб-токене это не так.
 */
export const MIN_INTERVAL_MS = 1_000;
/** Повторов на 6/10 и капче, прежде чем отдать ошибку наверх. */
export const FLOOD_RETRIES = 3;
/** Пауза после капчи без решателя: VK отпускает за ~10 с. */
export const CAPTCHA_BACKOFF_MS = 10_000;
/**
 * Что повторяем через секунды: 6 — секундный лимит, 10 — сбой VK.
 * 9 и 29 — нет: это карантин ключа на минуты–сутки, повтор его продлевает.
 */
export const RETRY_NOW_CODES = new Set([6, 10]);
/** Суточный потолок вызовов на аккаунт (Long Poll не в счёт); число на глаз, как в Chutter. */
export const DAILY_REQUEST_CAP = 20_000;
const DAY_MS = 86_400_000;

export interface VkTokens {
  token(force?: boolean): Promise<VkToken>;
}

export type VkParams = Record<string, string | number | boolean | undefined>;

const realSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Клиент VK API одного аккаунта: темп, повторы и типизированные ошибки.
 * Единственная дверь наружу для аккаунта — Long Poll и загрузки идут им же,
 * тем же прокси: токен привязан к адресу.
 */
export class VkApi {
  private chain: Promise<void> = Promise.resolve();
  private lastCallAt: number | null = null;
  private dayStartedAt: number;
  private dayCalls = 0;

  constructor(
    private readonly http: VkHttp,
    private readonly tokens: VkTokens,
    private readonly opts: {
      host?: string;
      version?: string;
      minIntervalMs?: number;
      floodRetries?: number;
      now?: () => number;
      sleep?: (ms: number) => Promise<void>;
    } = {},
  ) {
    this.dayStartedAt = this.now();
  }

  private now() {
    return (this.opts.now ?? Date.now)();
  }

  private sleep(ms: number) {
    return (this.opts.sleep ?? realSleep)(ms);
  }

  /**
   * Выдержать интервал между запросами. Очередь, а не голое поле: иначе
   * N вызовов читают одно время, спят одинаково и просыпаются залпом.
   */
  private pace(): Promise<void> {
    const interval = this.opts.minIntervalMs ?? MIN_INTERVAL_MS;
    const turn = this.chain.then(async () => {
      if (interval > 0 && this.lastCallAt !== null) {
        const wait = interval - (this.now() - this.lastCallAt);
        if (wait > 0) await this.sleep(wait);
      }
      this.lastCallAt = this.now();
    });
    this.chain = turn.catch(() => undefined);
    return turn;
  }

  private countCall(method: string) {
    const now = this.now();
    if (now - this.dayStartedAt >= DAY_MS) {
      this.dayStartedAt = now;
      this.dayCalls = 0;
    }
    if (this.dayCalls >= DAILY_REQUEST_CAP)
      throw new VkFlood(
        29,
        `суточный потолок ${DAILY_REQUEST_CAP} запросов аккаунта исчерпан`,
        { method, retryAfterMs: this.dayStartedAt + DAY_MS - now },
      );
    this.dayCalls++;
  }

  /** Один запрос без разбора ошибки: `{response}` или `{error}`. */
  async raw(method: string, params: VkParams = {}): Promise<unknown> {
    this.countCall(method);
    await this.pace();
    const { accessToken } = await this.tokens.token();
    const body = new URLSearchParams({ v: this.opts.version ?? API_VERSION });
    for (const [k, v] of Object.entries(params))
      if (v !== undefined) body.set(k, String(v));
    const res = await fetchWithRetry(
      this.http,
      `https://${this.opts.host ?? API_HOST}/method/${method}`,
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${accessToken}`,
          'content-type': 'application/x-www-form-urlencoded',
        },
        body: body.toString(),
      },
      (ms) => this.sleep(ms),
    );
    const text = await res.text();
    if (res.status !== 200)
      throw new VkApiError(0, `HTTP ${res.status}: ${text.slice(0, 200)}`, {
        method,
      });
    return JSON.parse(text);
  }

  /**
   * Вызов метода. Повторяет 6/10 и капчу с паузой; на 5/1117/1130 один раз
   * перевыпускает токен. `strict` — без повторов: холодная рассылка должна
   * сама увидеть флуд и капчу и остановить аккаунт, а не пробиваться сквозь них.
   */
  async call<T = unknown>(
    method: string,
    params: VkParams = {},
    { strict = false }: { strict?: boolean } = {},
  ): Promise<T> {
    let attempts = 0;
    let refreshed = false;
    const retries = this.opts.floodRetries ?? FLOOD_RETRIES;
    for (;;) {
      const payload = await this.raw(method, params);
      const err = classify(payload, method);
      if (!err) return (payload as { response: T }).response;
      if (TOKEN_CODES.has(err.code)) {
        if (refreshed) {
          if (err instanceof VkIpMismatch)
            throw new VkIpMismatch(
              err.code,
              `${err.vkMessage} — и после перевыпуска: прокси меняет IP на каждое соединение, нужен липкий`,
              err.opts,
            );
          throw new VkTokenDead(err.code, err.vkMessage, err.opts);
        }
        refreshed = true;
        // Чужой IP: сначала новое соединение, потом выпуск — оба на текущем адресе.
        if (err instanceof VkIpMismatch) this.http.reset?.();
        await this.tokens.token(true);
        continue;
      }
      if (strict) throw err;
      const retryable =
        err instanceof VkCaptcha || RETRY_NOW_CODES.has(err.code);
      if (!retryable || attempts >= retries) throw err;
      attempts++;
      await this.sleep(
        err.retryAfterMs ??
          (err instanceof VkCaptcha
            ? CAPTCHA_BACKOFF_MS
            : 2 ** attempts * 1000),
      );
    }
  }

  /** GET на абсолютный адрес тем же клиентом и прокси (сервер Long Poll). */
  async getUrl(
    url: string,
    params: VkParams,
    timeoutMs?: number,
  ): Promise<unknown> {
    const u = new URL(url.startsWith('http') ? url : `https://${url}`);
    for (const [k, v] of Object.entries(params))
      if (v !== undefined) u.searchParams.set(k, String(v));
    const res = await this.http.fetch(u.toString(), {
      method: 'GET',
      ...(timeoutMs ? { timeout: timeoutMs } : {}),
    });
    const text = await res.text();
    if (res.status !== 200)
      throw new VkApiError(0, `HTTP ${res.status}: ${text.slice(0, 200)}`, {
        method: u.pathname,
      });
    return JSON.parse(text);
  }

  /**
   * Multipart на адрес загрузчика VK — тем же прокси: загрузчики заблокированы
   * так же, как сам VK, без прокси загрузка висит до таймаута.
   */
  async postFile(
    url: string,
    file: {
      field?: string;
      filename: string;
      content: Uint8Array;
      type: string;
    },
  ): Promise<Record<string, unknown>> {
    const form = new FormData();
    form.append(
      file.field ?? 'file',
      new Blob([new Uint8Array(file.content)], { type: file.type }),
      file.filename,
    );
    let res;
    try {
      res = await this.http.fetch(url, { method: 'POST', body: form });
    } catch (e) {
      throw new VkApiError(0, `загрузка: ${(e as Error).message}`, {
        method: url,
      });
    }
    const text = await res.text();
    if (res.status !== 200)
      throw new VkApiError(
        0,
        `загрузка HTTP ${res.status}: ${text.slice(0, 200)}`,
        {
          method: url,
        },
      );
    try {
      return JSON.parse(text) as Record<string, unknown>;
    } catch {
      // Узел отдал HTML-заглушку с 200 — тот же сбой загрузки.
      throw new VkApiError(0, `загрузка не JSON: ${text.slice(0, 200)}`, {
        method: url,
      });
    }
  }

  /** Файл с CDN VK (медиа входящих) тем же прокси. */
  async download(url: string, maxBytes = 25 * 1024 * 1024): Promise<Buffer> {
    const res = await this.http.fetch(url, { method: 'GET' });
    if (res.status !== 200)
      throw new VkApiError(0, `скачивание HTTP ${res.status}`, { method: url });
    const declared = Number(res.headers.get('content-length') ?? 0);
    if (declared > maxBytes)
      throw new VkApiError(0, `медиа ${declared} байт больше потолка`, {
        method: url,
      });
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > maxBytes)
      throw new VkApiError(0, `медиа ${buf.length} байт больше потолка`, {
        method: url,
      });
    return buf;
  }
}
