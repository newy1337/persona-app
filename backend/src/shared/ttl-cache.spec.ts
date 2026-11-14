import { TtlCache } from './ttl-cache';

describe('TtlCache', () => {
  beforeAll(() => {
    TtlCache.keep = true;
  });
  afterAll(() => {
    TtlCache.keep = false;
  });

  it('одновременные запросы ждут одну загрузку, готовый ответ отдаётся из кеша', async () => {
    const cache = new TtlCache();
    let calls = 0;
    const load = async () => {
      calls += 1;
      await new Promise((r) => setTimeout(r, 5));
      return calls;
    };
    const [a, b] = await Promise.all([
      cache.get('k', 1000, load),
      cache.get('k', 1000, load),
    ]);
    expect([a, b, calls]).toEqual([1, 1, 1]);
    expect(await cache.get('k', 1000, load)).toBe(1);
    expect(await cache.get('other', 1000, load)).toBe(2);
  });

  it('по истечении срока и после clear загружает заново; ошибку не кеширует', async () => {
    const cache = new TtlCache();
    let n = 0;
    expect(await cache.get('k', 0, async () => ++n)).toBe(1);
    expect(await cache.get('k', 1000, async () => ++n)).toBe(2);
    cache.clear();
    expect(await cache.get('k', 1000, async () => ++n)).toBe(3);
    await expect(
      cache.get('bad', 1000, async () => {
        throw new Error('x');
      }),
    ).rejects.toThrow('x');
    expect(await cache.get('bad', 1000, async () => 7)).toBe(7);
  });
});
