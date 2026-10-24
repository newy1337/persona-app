import { describe, expect, it } from 'vitest';
import { parseVkCookies } from './vkCookies';

describe('куки VK из браузера', () => {
  it('выгрузка расширения: только домены VK', () => {
    const r = parseVkCookies(JSON.stringify([
      { name: 'remixsid', value: 's1', domain: '.vk.ru', path: '/' },
      { name: '_ga', value: 'x', domain: '.google.com' },
    ]));
    expect(r).toEqual({ ok: true, cookies: [{ name: 'remixsid', value: 's1', domain: '.vk.ru', path: '/' }] });
  });

  it('строка Cookie из DevTools', () => {
    const r = parseVkCookies('Cookie: remixsid=s2; remixlang=0');
    expect(r.ok).toBe(true);
    expect(r.cookies.map((c) => c.name)).toEqual(['remixsid', 'remixlang']);
  });

  it('без remixsid и битый JSON — ошибка словами', () => {
    expect(parseVkCookies('remixlang=0').error).toMatch(/remixsid/);
    expect(parseVkCookies('[{').error).toMatch(/не JSON/);
    expect(parseVkCookies('').ok).toBe(false);
  });
});
