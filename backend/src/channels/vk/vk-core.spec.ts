import { VkApi } from './api';
import {
  VkCaptcha,
  VkFlood,
  VkIpMismatch,
  VkPeerUnavailable,
  VkSessionExpired,
  VkSpamRestricted,
  VkTokenDead,
  VkTokenMintFailed,
  classify,
  isTerminal,
} from './errors';
import type { HttpInit, HttpResponse, VkHttp } from './http';
import {
  VkTokenProvider,
  cookieHeader,
  mergeCookies,
  parseSetCookies,
  pickCookies,
  type VkCookie,
} from './session';

const res = (
  status: number,
  body: unknown,
  headers: Record<string, string | string[]> = {},
): HttpResponse => {
  const h = new Headers();
  for (const [k, v] of Object.entries(headers))
    for (const one of [v].flat()) h.append(k, one);
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  return {
    status,
    headers: h,
    text: async () => text,
    arrayBuffer: async () => new TextEncoder().encode(text).buffer,
  };
};

/** Фейковый HTTP: отвечает по очереди, запоминает запросы. */
const fakeHttp = (...answers: Array<HttpResponse | Error>) => {
  const calls: Array<{ url: string; init?: HttpInit }> = [];
  let resets = 0;
  const http: VkHttp = {
    fetch: async (url, init) => {
      calls.push({ url, init });
      const next = answers.shift();
      if (!next) throw new Error(`лишний запрос ${url}`);
      if (next instanceof Error) throw next;
      return next;
    },
    reset: () => {
      resets++;
    },
  };
  return { http, calls, resets: () => resets };
};

const session: VkCookie[] = [
  { name: 'remixsid', value: 'sid1', domain: '.vk.ru' },
  { name: 'httoken', value: 'h1', domain: '.login.vk.ru' },
];

const clock = () => {
  let t = 1_000_000;
  return {
    now: () => t,
    sleep: async (ms: number) => {
      t += ms;
    },
    advance: (ms: number) => {
      t += ms;
    },
  };
};

describe('ошибки VK', () => {
  it('1130 — чужой IP, а не протухший токен', () => {
    const e = classify({
      error: { error_code: 5, error_msg: 'x', error_subcode: 1130 },
    });
    expect(e).toBeInstanceOf(VkIpMismatch);
  });

  it('коды раскладываются по смыслу', () => {
    const of = (code: number) =>
      classify({ error: { error_code: code, error_msg: '' } });
    expect(of(6)).toBeInstanceOf(VkFlood);
    expect(of(983)).toBeInstanceOf(VkSpamRestricted);
    expect(of(902)).toBeInstanceOf(VkPeerUnavailable);
    expect(of(14)).toBeInstanceOf(VkCaptcha);
    expect(isTerminal(of(14))).toBe(true);
    expect(isTerminal(of(6))).toBe(false);
    expect(classify({ response: 1 })).toBeNull();
  });

  it('капча несёт адрес решения', () => {
    const e = classify({
      error: {
        error_code: 14,
        error_msg: '',
        redirect_uri: 'https://id.vk.ru/c',
      },
    }) as VkCaptcha;
    expect(e.redirectUri).toBe('https://id.vk.ru/c');
  });
});

describe('куки сессии', () => {
  it('кука домена — хосту и поддоменам, не наоборот', () => {
    expect(cookieHeader(session, 'https://login.vk.ru/?act=web_token')).toBe(
      'remixsid=sid1; httoken=h1',
    );
    expect(cookieHeader(session, 'https://vk.ru/im')).toBe('remixsid=sid1');
    expect(cookieHeader(session, 'https://api.vk.com/method/x')).toBe('');
  });

  it('из снимка браузера берём только нужные куки VK', () => {
    expect(
      pickCookies([
        { name: 'remixsid', value: 'a', domain: '.vk.ru' },
        { name: '_ga', value: 'b', domain: '.vk.ru' },
        { name: 'remixsid', value: 'c', domain: '.example.com' },
      ]),
    ).toEqual([{ name: 'remixsid', value: 'a', domain: '.vk.ru', path: '/' }]);
  });

  it('ротация: новое значение заменяет старое, без изменений — null', () => {
    const fresh = parseSetCookies(
      [
        'remixsid=sid2; Domain=vk.ru; Path=/; Secure',
        'remixlang=DELETED; Max-Age=0',
      ],
      'https://login.vk.ru/',
    );
    expect(fresh).toEqual([
      { name: 'remixsid', value: 'sid2', domain: 'vk.ru', path: '/' },
    ]);
    const merged = mergeCookies(session, fresh)!;
    expect(merged.find((c) => c.name === 'remixsid')?.value).toBe('sid2');
    expect(merged).toHaveLength(2);
    expect(mergeCookies(merged, fresh)).toBeNull();
  });
});

describe('выпуск web_token', () => {
  const okToken = (token: string, extra: Record<string, string[]> = {}) =>
    res(
      200,
      {
        type: 'okay',
        data: { access_token: token, expires: 2_000, user_id: 77 },
      },
      extra,
    );

  it('выпускает по кукам, кэширует до запаса и сохраняет ротацию кук', async () => {
    const c = clock();
    const { http, calls } = fakeHttp(
      okToken('t1', { 'set-cookie': ['remixsid=sid2; Domain=.vk.ru'] }),
    );
    const saved: VkCookie[][] = [];
    const p = new VkTokenProvider(
      http,
      { cookies: session },
      {
        ...c,
        onCookies: (d) => {
          saved.push(d.cookies);
        },
      },
    );
    const [a, b] = await Promise.all([p.token(), p.token()]);
    expect(a.accessToken).toBe('t1');
    expect(b).toBe(a);
    expect(a.expiresAt).toBe(2_000_000);
    expect(a.userId).toBe(77);
    expect(calls).toHaveLength(1);
    expect(calls[0].init?.body).toBe('version=1&app_id=6287487');
    expect(calls[0].init?.headers?.cookie).toBe('remixsid=sid1; httoken=h1');
    expect(saved[0].find((x) => x.name === 'remixsid')?.value).toBe('sid2');
    // Повторно не выпускает, пока срок далеко.
    await p.token();
    expect(calls).toHaveLength(1);
  });

  it('unauthorized — сессия умерла; пустой ответ — частый выпуск', async () => {
    const c = clock();
    const dead = new VkTokenProvider(
      fakeHttp(res(200, { type: 'error', error_info: 'unauthorized' })).http,
      { cookies: session },
      c,
    );
    await expect(dead.token()).rejects.toBeInstanceOf(VkSessionExpired);
    const empty = new VkTokenProvider(
      fakeHttp(res(200, '')).http,
      { cookies: session },
      c,
    );
    await expect(empty.token()).rejects.toBeInstanceOf(VkTokenMintFailed);
  });

  it('без remixsid даже не ходит', async () => {
    const { http, calls } = fakeHttp();
    const p = new VkTokenProvider(http, { cookies: [] });
    await expect(p.token()).rejects.toBeInstanceOf(VkSessionExpired);
    expect(calls).toHaveLength(0);
  });

  it('повторный выпуск не раньше чем через 30 с; 503 пула повторяется', async () => {
    const c = clock();
    const { http, calls } = fakeHttp(
      okToken('t1'),
      res(503, 'Node rejected'),
      okToken('t2'),
    );
    const p = new VkTokenProvider(http, { cookies: session }, c);
    await p.token();
    const t0 = c.now();
    const t2 = await p.token(true);
    expect(t2.accessToken).toBe('t2');
    expect(c.now() - t0).toBeGreaterThanOrEqual(30_000);
    expect(calls).toHaveLength(3);
  });
});

describe('VkApi', () => {
  const tokens = () => {
    let current = 'tok';
    return {
      token: async (force = false) => {
        if (force) current = 'fresh';
        return {
          accessToken: current,
          expiresAt: 0,
          userId: 1,
        };
      },
    };
  };

  it('держит 1 запрос/с на аккаунт, даже когда вызовы идут разом', async () => {
    const c = clock();
    const { http } = fakeHttp(
      ...[1, 2, 3].map((n) => res(200, { response: n })),
    );
    const slept: number[] = [];
    const api = new VkApi(http, tokens(), {
      now: c.now,
      sleep: (ms) => {
        slept.push(ms);
        return c.sleep(ms);
      },
    });
    expect(
      await Promise.all([api.call('a'), api.call('b'), api.call('c')]),
    ).toEqual([1, 2, 3]);
    // Первый сразу, каждый следующий — через секунду после предыдущего.
    expect(slept).toEqual([1_000, 1_000]);
  });

  it('шлёт токен и версию, разбирает ответ', async () => {
    const { http, calls } = fakeHttp(res(200, { response: [{ id: 5 }] }));
    const api = new VkApi(http, tokens(), { minIntervalMs: 0 });
    expect(
      await api.call('users.get', { user_ids: 'durov', skip: undefined }),
    ).toEqual([{ id: 5 }]);
    expect(calls[0].url).toBe('https://api.vk.com/method/users.get');
    expect(calls[0].init?.headers?.authorization).toBe('Bearer tok');
    expect(calls[0].init?.body).toBe('v=5.444&user_ids=durov');
  });

  it('6 повторяет с паузой, 9 сразу наверх', async () => {
    const c = clock();
    const { http } = fakeHttp(
      res(200, { error: { error_code: 6, error_msg: 'Too many' } }),
      res(200, { response: 'ok' }),
      res(200, { error: { error_code: 9, error_msg: 'Flood control' } }),
    );
    const api = new VkApi(http, tokens(), { minIntervalMs: 0, ...c });
    expect(await api.call('a')).toBe('ok');
    await expect(api.call('b')).rejects.toBeInstanceOf(VkFlood);
  });

  it('strict: флуд и капча — сразу наверх', async () => {
    const { http, calls } = fakeHttp(
      res(200, { error: { error_code: 6, error_msg: '' } }),
    );
    const api = new VkApi(http, tokens(), { minIntervalMs: 0 });
    await expect(api.call('a', {}, { strict: true })).rejects.toBeInstanceOf(
      VkFlood,
    );
    expect(calls).toHaveLength(1);
  });

  it('токен отвергнут: один перевыпуск, снова — сессия мертва', async () => {
    const t = tokens();
    const { http, calls } = fakeHttp(
      res(200, { error: { error_code: 5, error_msg: 'invalid' } }),
      res(200, { response: 1 }),
      res(200, { error: { error_code: 5, error_msg: 'invalid' } }),
      res(200, { error: { error_code: 1117, error_msg: 'expired' } }),
    );
    const api = new VkApi(http, t, { minIntervalMs: 0 });
    expect(await api.call('a')).toBe(1);
    expect(calls[1].init?.headers?.authorization).toBe('Bearer fresh');
    await expect(api.call('b')).rejects.toBeInstanceOf(VkTokenDead);
  });

  it('1130: новое соединение и перевыпуск; не помогло — виноват прокси', async () => {
    const mismatch = res(200, {
      error: { error_code: 5, error_msg: 'another ip', error_subcode: 1130 },
    });
    const { http, resets } = fakeHttp(mismatch, mismatch);
    const api = new VkApi(http, tokens(), { minIntervalMs: 0 });
    const err = await api.call<never>('a').catch((e: VkIpMismatch) => e);
    expect(err).toBeInstanceOf(VkIpMismatch);
    expect(err.message).toContain('липкий');
    expect(resets()).toBe(1);
  });

  it('суточный потолок — флуд 29 без запроса', async () => {
    const { http } = fakeHttp(res(200, { response: 1 }));
    const api = new VkApi(http, tokens(), { minIntervalMs: 0 });
    (api as unknown as { dayCalls: number }).dayCalls = 20_000;
    const err = await api.call<never>('a').catch((e: VkFlood) => e);
    expect(err).toBeInstanceOf(VkFlood);
    expect(err.code).toBe(29);
  });
});
