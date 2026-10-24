import { VkSessionExpired, VkTokenMintFailed } from './errors';
import { isNetworkError, setCookies, type HttpInit, type VkHttp } from './http';

/**
 * Сессия VK-аккаунта: куки входа и выпуск `web_token` по ним.
 *
 * Клиент vk.ru/im делает `POST login.vk.ru/?act=web_token` с телом
 * `version=1&app_id=6287487` и получает access_token на ~15 минут. Авторизует
 * сессионная кука, пароля и токена в запросе нет — браузер нужен один раз,
 * чтобы получить куки (снято с живого клиента, Chutter 16.09).
 *
 * Токен кэшируем: второй выпуск подряд VK отдаёт пустым ответом. Новый берём,
 * когда до истечения меньше REFRESH_MARGIN_MS.
 */

export interface VkCookie {
  name: string;
  value: string;
  domain: string;
  path?: string;
}

/** То, что лежит зашифрованным в `channel_accounts.session_encrypted` у VK. */
export interface VkSessionData {
  cookies: VkCookie[];
  /** UA браузера входа: для VK аккаунт — одно «устройство». */
  userAgent?: string | null;
  savedAt?: number;
}

export interface VkToken {
  accessToken: string;
  /** Unix-миллисекунды. */
  expiresAt: number;
  userId: number | null;
}

/** Веб-приложение VK, чей токен принимают и web.api.vk.ru, и api.vk.com. */
export const WEB_APP_ID = '6287487';
export const MINT_URL = 'https://login.vk.ru/?act=web_token';
export const REFRESH_MARGIN_MS = 180_000;
/** Пауза между неудачными выпусками: долбёжка выпуска — сигнал бота. */
export const MINT_RETRY_DELAY_MS = 30_000;
/** Ротирующий пул прокси отдаёт 502–504 на ровном месте; повтор почти всегда проходит. */
export const TRANSIENT_RETRIES = 4;
export const TRANSIENT_BACKOFF_MS = 1_500;

/** Куки, которые держат сессию; остальное из браузера не нужно. */
const KEEP = new Set([
  'remixsid',
  'remixstlid',
  'remixstid',
  'remixlang',
  'remixir',
  'httoken',
  'p',
  'sua',
  'sui',
]);

const bare = (domain: string) => domain.replace(/^\./, '');

/** Куки VK из снимка браузера (CDP / Playwright): только домены vk.* и нужные имена. */
export function pickCookies(
  raw: Array<{ name: string; value: string; domain: string; path?: string }>,
): VkCookie[] {
  return raw
    .filter((c) => c.domain.includes('vk.') && KEEP.has(c.name))
    .map((c) => ({
      name: c.name,
      value: c.value,
      domain: c.domain,
      path: c.path ?? '/',
    }));
}

export const hasSession = (cookies: VkCookie[]): boolean =>
  cookies.some((c) => c.name === 'remixsid' && c.value);

/**
 * Заголовок Cookie для адреса: кука домена D — хосту D и его поддоменам,
 * не наоборот (RFC 6265). Обратное слало куки login.vk.ru на vk.ru, и VK
 * отдавал гостевую страницу (Chutter 13.10).
 */
export function cookieHeader(cookies: VkCookie[], url: string): string {
  const host = new URL(url).hostname;
  return cookies
    .filter((c) => {
      const base = bare(c.domain);
      return host === base || host.endsWith(`.${base}`);
    })
    .map((c) => `${c.name}=${c.value}`)
    .join('; ');
}

/** Куки из Set-Cookie ответа (домен по умолчанию — хост запроса). */
export function parseSetCookies(values: string[], url: string): VkCookie[] {
  const host = new URL(url).hostname;
  const out: VkCookie[] = [];
  for (const v of values) {
    const [pair, ...attrs] = v.split(';').map((s) => s.trim());
    const eq = pair.indexOf('=');
    if (eq <= 0) continue;
    const name = pair.slice(0, eq);
    if (!KEEP.has(name)) continue;
    let domain = host;
    let path = '/';
    let expired = false;
    for (const a of attrs) {
      const [k, ...rest] = a.split('=');
      const val = rest.join('=');
      const key = k.toLowerCase();
      if (key === 'domain' && val) domain = val;
      else if (key === 'path' && val) path = val;
      else if (key === 'max-age' && Number(val) <= 0) expired = true;
      else if (key === 'expires' && Date.parse(val) < Date.now())
        expired = true;
    }
    // Удалённую куку VK присылает как DELETED / истёкшую — сессию ею не затираем.
    if (expired || pair.slice(eq + 1) === 'DELETED') continue;
    out.push({ name, value: pair.slice(eq + 1), domain, path });
  }
  return out;
}

/** Новые значения кук поверх старых; null — ничего не поменялось. */
export function mergeCookies(
  current: VkCookie[],
  fresh: VkCookie[],
): VkCookie[] | null {
  const key = (c: VkCookie) => `${c.name}@${bare(c.domain)}`;
  const known = new Map(current.map((c) => [key(c), c.value]));
  const changed = new Map(
    fresh.filter((c) => known.get(key(c)) !== c.value).map((c) => [key(c), c]),
  );
  if (!changed.size) return null;
  return [...current.filter((c) => !changed.has(key(c))), ...changed.values()];
}

/** POST/GET с повтором на сбоях пула прокси: 502–504 и обрывы сети. */
export async function fetchWithRetry(
  http: VkHttp,
  url: string,
  init: HttpInit,
  sleep: (ms: number) => Promise<void>,
) {
  let last: unknown;
  for (let attempt = 1; attempt <= TRANSIENT_RETRIES; attempt++) {
    try {
      const res = await http.fetch(url, init);
      if (![502, 503, 504].includes(res.status)) return res;
      last = new Error(
        `HTTP ${res.status}: ${(await res.text()).slice(0, 80)}`,
      );
    } catch (e) {
      if (!isNetworkError(e)) throw e;
      last = e;
    }
    if (attempt < TRANSIENT_RETRIES)
      await sleep(TRANSIENT_BACKOFF_MS * attempt);
  }
  throw last;
}

const realSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Держит актуальный токен одного аккаунта. Один объект на аккаунт: свой
 * прокси, свои куки. Ротацию кук отдаёт наружу (`onCookies`) — без записи
 * рестарт поднимет старые куки, и сессия умрёт.
 */
export class VkTokenProvider {
  private current: VkToken | null = null;
  private minting: Promise<VkToken> | null = null;
  private lastMintAttempt = 0;

  constructor(
    private readonly http: VkHttp,
    private data: VkSessionData,
    private readonly opts: {
      now?: () => number;
      sleep?: (ms: number) => Promise<void>;
      onCookies?: (data: VkSessionData) => Promise<void> | void;
    } = {},
  ) {}

  get session(): VkSessionData {
    return this.data;
  }

  private now() {
    return (this.opts.now ?? Date.now)();
  }

  private sleep(ms: number) {
    return (this.opts.sleep ?? realSleep)(ms);
  }

  /** Актуальный токен; force — токен отвергнут, нужен новый. */
  async token(force = false): Promise<VkToken> {
    const cur = this.current;
    if (!force && cur && cur.expiresAt - this.now() > REFRESH_MARGIN_MS)
      return cur;
    // Один выпуск на всех: Long Poll и отправка на старте просят токен разом.
    if (!this.minting)
      this.minting = this.mintPaced().finally(() => {
        this.minting = null;
      });
    return this.minting;
  }

  private async mintPaced(): Promise<VkToken> {
    const since = this.now() - this.lastMintAttempt;
    if (this.lastMintAttempt && since < MINT_RETRY_DELAY_MS)
      await this.sleep(MINT_RETRY_DELAY_MS - since);
    this.lastMintAttempt = this.now();
    this.current = await this.mint();
    return this.current;
  }

  async absorb(fresh: VkCookie[]): Promise<void> {
    const merged = mergeCookies(this.data.cookies, fresh);
    if (!merged) return;
    this.data = { ...this.data, cookies: merged, savedAt: this.now() };
    await this.opts.onCookies?.(this.data);
  }

  private async mint(): Promise<VkToken> {
    if (!hasSession(this.data.cookies))
      throw new VkSessionExpired('нет кук сессии — нужен вход браузером');
    const res = await fetchWithRetry(
      this.http,
      MINT_URL,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
          referer: 'https://vk.ru/',
          origin: 'https://vk.ru',
          cookie: cookieHeader(this.data.cookies, MINT_URL),
        },
        body: new URLSearchParams({
          version: '1',
          app_id: WEB_APP_ID,
        }).toString(),
      },
      (ms) => this.sleep(ms),
    );
    const body = (await res.text()).trim();
    if (!body)
      throw new VkTokenMintFailed('', 'пустой ответ — слишком частый выпуск');
    let payload: {
      type?: string;
      error_info?: string;
      data?: { access_token?: string; expires?: number; user_id?: number };
    };
    try {
      payload = JSON.parse(body);
    } catch {
      throw new VkTokenMintFailed('', body.slice(0, 200));
    }
    if (payload.type === 'error') {
      if (payload.error_info === 'unauthorized')
        throw new VkSessionExpired(
          'куки сессии отвергнуты — нужен новый вход браузером',
        );
      throw new VkTokenMintFailed(payload.error_info ?? '', body.slice(0, 200));
    }
    const d = payload.data ?? {};
    if (!d.access_token) throw new VkTokenMintFailed('', body.slice(0, 200));
    await this.absorb(parseSetCookies(setCookies(res.headers), MINT_URL));
    return {
      accessToken: d.access_token,
      expiresAt: d.expires ? d.expires * 1000 : this.now() + 900_000,
      userId: d.user_id ? Number(d.user_id) : null,
    };
  }
}
