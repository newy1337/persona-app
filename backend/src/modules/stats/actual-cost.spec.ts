import { actualCost, costOfSums, listCost } from './dialog-cost';
import type { ModelPrice } from './prices';

const price: ModelPrice = {
  input: 3,
  output: 15,
  cache_write: 3.75,
  cache_read: 0.3,
};
const tokens = { input: 1_000_000, output: 0, cache_write: 0, cache_read: 0 };

describe('фактическая цена вызовов', () => {
  it('шлюз — бесплатно; по прайсу он стоил бы как обычно (для LLMR)', () => {
    expect(
      actualCost({ provider: 'gateway', price, tokens, cacheWrite1h: 0 }),
    ).toBe(0);
    expect(listCost(price, tokens, 0)).toBe(3);
  });

  it('NanoGPT и OpenRouter — сколько выставили сами, без суммы — по прайсу', () => {
    const base = { price, tokens, cacheWrite1h: 0 };
    expect(actualCost({ ...base, provider: 'nanogpt', estimated: 1.2 })).toBe(
      1.2,
    );
    expect(
      actualCost({ ...base, provider: 'openrouter', estimated: null }),
    ).toBe(3);
  });

  it('прочие (распознавание речи) — по прайсу; модель без цены — сумма провайдера', () => {
    expect(
      actualCost({ provider: 'openai', price, tokens, cacheWrite1h: 0 }),
    ).toBe(3);
    expect(
      actualCost({
        provider: 'openai',
        price: null,
        tokens,
        cacheWrite1h: 0,
        estimated: 0.4,
      }),
    ).toBe(0.4);
  });

  it('сумма по моделям и маршрутам: шлюз не добавляет денег', () => {
    const row = {
      model: 'claude-sonnet-5',
      input: 1_000_000,
      output: 0,
      cache_write: 0,
      cache_read: 0,
      cache_write_1h: 0,
    };
    expect(
      costOfSums(
        [
          { ...row, provider: 'gateway' },
          { ...row, provider: 'nanogpt', estimated: 2.5 },
        ],
        () => price,
      ),
    ).toBe(2.5);
  });
});
