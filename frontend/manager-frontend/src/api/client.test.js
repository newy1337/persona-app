import { describe, it, expect, beforeEach, vi } from 'vitest';
import { api, ApiError, setTokens } from './client';

function mockFetch(status = 200, body = {}) {
  const fn = vi.fn(async () => ({
    ok: status >= 200 && status < 300,
    status,
    statusText: 'x',
    json: async () => body,
  }));
  globalThis.fetch = fn;
  return fn;
}

beforeEach(() => {
  const store = new Map();
  globalThis.window = {
    localStorage: {
      getItem: (k) => store.get(k) ?? null,
      setItem: (k, v) => store.set(k, String(v)),
      removeItem: (k) => store.delete(k),
    },
  };
  setTokens({ accessToken: 'tok123', refreshToken: 'ref456' });
});

describe('api client', () => {
  it('шлёт Bearer-токен на GET', async () => {
    const f = mockFetch(200, { ok: true });
    await api.get('/api/manager/queue');
    expect(f.mock.calls[0][1].headers.Authorization).toBe('Bearer tok123');
  });

  it('шлёт Bearer-токен на мутации', async () => {
    const f = mockFetch(200, { ok: true });
    await api.post('/api/conversations/1/pause');
    expect(f.mock.calls[0][1].headers.Authorization).toBe('Bearer tok123');
    expect(f.mock.calls[0][1].method).toBe('POST');
  });

  it('без токена заголовка нет', async () => {
    setTokens(null);
    const f = mockFetch(200, {});
    await api.get('/api/manager/stats');
    expect(f.mock.calls[0][1].headers.Authorization).toBeUndefined();
  });

  it('ошибка несёт message бэка (Nest)', async () => {
    mockFetch(422, { statusCode: 422, message: 'invalid funnel_stage' });
    await expect(api.post('/api/conversations/1/set-stage', { stage: 'x' })).rejects.toMatchObject({
      status: 422,
      detail: 'invalid funnel_stage',
    });
  });

  it('массив сообщений валидации склеивается', async () => {
    mockFetch(400, { statusCode: 400, message: ['text must be a string', 'voice must be a boolean'] });
    await expect(api.post('/api/conversations/1/message', {})).rejects.toBeInstanceOf(ApiError);
  });

  it.each(['/api/manager/queue', '/auth/me'])('на 401 продлевает вход и повторяет %s один раз', async (path) => {
    const calls = [];
    globalThis.fetch = vi.fn(async (url, init) => {
      calls.push(url);
      if (url.endsWith('/auth/token/refresh')) {
        return { ok: true, status: 200, json: async () => ({ tokens: { accessToken: 'new', refreshToken: 'ref456' } }) };
      }
      const first = calls.filter((u) => u === url).length === 1;
      return first
        ? { ok: false, status: 401, statusText: 'x', json: async () => ({}) }
        : { ok: true, status: 200, json: async () => ({ items: [] }) };
    });
    const data = await api.get(path);
    expect(data).toEqual({ items: [] });
    expect(calls.some((u) => u.endsWith('/auth/token/refresh'))).toBe(true);
    expect(globalThis.fetch.mock.calls.at(-1)[1].headers.Authorization).toBe('Bearer new');
  });

  it('пути панели не менялись', async () => {
    const f = mockFetch(200, { items: [] });
    await api.get('/api/conversations/5/media/inbound/list');
    expect(f.mock.calls[0][0]).toBe('/api/conversations/5/media/inbound/list');
  });
});
