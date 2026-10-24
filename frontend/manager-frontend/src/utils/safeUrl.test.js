import { describe, expect, it } from 'vitest';
import { httpHref } from './safeUrl';

describe('httpHref', () => {
  it('пропускает http и https', () => {
    expect(httpHref('https://example.com/u/1')).toBe('https://example.com/u/1');
    expect(httpHref(' HTTP://vk.com/id5 ')).toBe('HTTP://vk.com/id5');
  });
  it('отбрасывает опасные и пустые значения', () => {
    for (const bad of ['javascript:alert(1)', 'data:text/html,x', 'vbscript:x', '//evil.com', 'ftp://x', '', null, undefined, 'https://a b'])
      expect(httpHref(bad)).toBeNull();
  });
});
