import { Impit, TransportError } from 'impit';

/**
 * HTTP аккаунта VK, который на проводе выглядит как браузер.
 *
 * Обычный fetch Node выдаёт себя с первого рукопожатия (JA4 t13d5212h1,
 * HTTP/1.1). impit с профилем chrome151 даёт JA4 t13d1516h2_8daaf6152771_806a8c22fdea
 * и HTTP/2 Chrome — тот же отпечаток, что у маски curl_cffi chrome150 в
 * Chutter, на которой VK-парк живёт в бою.
 *
 * Профиль закреплён версией: алиас `chrome` уедет с обновлением impit.
 */
export const IMPERSONATE = 'chrome151' as const;

/** UA по умолчанию — под тот же Chrome, что и отпечаток (sec-ch-ua говорит 151). */
export const DEFAULT_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36';

/**
 * Заголовки XHR веб-клиента vk.ru вместо навигационных, которые impit ставит
 * по умолчанию (`sec-fetch-mode: navigate`, `upgrade-insecure-requests`).
 * Пустое значение у impit снимает заголовок. С навигационными заголовками VK
 * отвечал на выпуск токена «too much tries» (Chutter, живьём 13.10).
 */
const XHR_HEADERS: Record<string, string> = {
  accept: '*/*',
  'sec-fetch-mode': 'cors',
  'sec-fetch-site': 'same-site',
  'sec-fetch-dest': 'empty',
  'upgrade-insecure-requests': '',
  'sec-fetch-user': '',
  priority: 'u=1, i',
};

/** Client hints Chrome; при UA другого браузера их быть не должно. */
const CLIENT_HINTS = ['sec-ch-ua', 'sec-ch-ua-mobile', 'sec-ch-ua-platform'];

export interface HttpResponse {
  status: number;
  headers: Headers;
  text(): Promise<string>;
  arrayBuffer(): Promise<ArrayBuffer>;
}

export interface HttpInit {
  method?: 'GET' | 'POST';
  headers?: Record<string, string>;
  body?: string | URLSearchParams | FormData;
  timeout?: number;
}

/** Узкая дверь наружу: в бою impit, в тестах — фейк. */
export interface VkHttp {
  fetch(url: string, init?: HttpInit): Promise<HttpResponse>;
  /** Новый пул соединений: старый keep-alive держит выходной IP, который липкий прокси уже сменил. */
  reset?(): void;
}

export function browserHttp(opts: {
  proxyUrl: string | null;
  userAgent?: string | null;
  timeoutMs?: number;
}): VkHttp {
  const ua = opts.userAgent || DEFAULT_UA;
  const headers: Record<string, string> = { ...XHR_HEADERS, 'user-agent': ua };
  if (!/Chrome\//.test(ua)) for (const h of CLIENT_HINTS) headers[h] = '';
  const make = () =>
    new Impit({
      browser: IMPERSONATE,
      proxyUrl: opts.proxyUrl ?? undefined,
      timeout: opts.timeoutMs ?? 30_000,
      headers,
      // Редиректы VK (302 на login.vk.ru) обрабатываем сами: на них ротируются куки.
      followRedirects: false,
    });
  let impit = make();
  return {
    fetch: (url, init) =>
      impit.fetch(url, init as Parameters<Impit['fetch']>[1]),
    reset: () => {
      impit = make();
    },
  };
}

/** Сбой сети или прокси, а не ответ VK: повторяемо. */
export const isNetworkError = (e: unknown): boolean =>
  e instanceof TransportError;

/** Значения Set-Cookie ответа (Headers.getSetCookie есть в Node 20+). */
export function setCookies(headers: Headers): string[] {
  const h = headers as Headers & { getSetCookie?: () => string[] };
  if (typeof h.getSetCookie === 'function') return h.getSetCookie();
  const raw = headers.get('set-cookie');
  return raw ? raw.split(/,(?=\s*[A-Za-z0-9_-]+=)/) : [];
}

/**
 * Почему аккаунт VK не на связи — словами для панели. Сетевые ошибки клиента
 * приходят текстом из Rust (hyper), менеджеру он ничего не скажет.
 */
export function vkOfflineReason(e: unknown): string | null {
  const name = (e as Error)?.constructor?.name ?? '';
  const text = String((e as Error)?.message ?? e ?? '');
  if (/Proxy/.test(name) || /proxy/i.test(text))
    return 'прокси не пускает — проверьте адрес, логин и пароль прокси';
  if (/Timeout/.test(name) || /timeout|timed out/i.test(text))
    return 'прокси или VK не ответили вовремя';
  if (
    e instanceof TransportError ||
    /Failed to connect|ConnectionRefused/i.test(text)
  )
    return 'нет соединения через прокси — прокси не отвечает';
  return null;
}
