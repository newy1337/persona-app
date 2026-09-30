import { usageValues } from './usage';

describe('anthropic usage normalisation', () => {
  it('sums cached and uncached input, prices by model', () => {
    const r = usageValues(
      {
        usage: {
          input_tokens: 1000,
          output_tokens: 200,
          cache_read_input_tokens: 12000,
          cache_creation_input_tokens: 0,
        },
      },
      'claude-opus-5',
    );
    expect(r).toEqual({
      inputTokens: 13000,
      outputTokens: 200,
      cachedTokens: 12000,
      cacheWriteTokens: 0,
      cacheWrite1hTokens: 0,
      providerEstimatedCostUsd: (1000 * 5 + 200 * 25 + 12000 * 0.5) / 1e6,
    });
  });

  it('cache write is billed at the write rate', () => {
    const r = usageValues(
      {
        usage: {
          input_tokens: 500,
          output_tokens: 50,
          cache_read_input_tokens: 0,
          cache_creation_input_tokens: 12000,
        },
      },
      'claude-sonnet-5',
    );
    expect(r.inputTokens).toBe(12500);
    expect(r.cachedTokens).toBe(0);
    expect(r.cacheWriteTokens).toBe(12000);
    expect(r.providerEstimatedCostUsd).toBeCloseTo(
      (500 * 2 + 50 * 10 + 12000 * 2.5) / 1e6,
      9,
    );
  });

  it('часовая запись кеша — ×2 от входа, пятиминутная — по ставке записи', () => {
    const r = usageValues(
      {
        usage: {
          input_tokens: 500,
          output_tokens: 50,
          cache_read_input_tokens: 0,
          cache_creation_input_tokens: 12000,
          cache_creation: {
            ephemeral_1h_input_tokens: 10000,
            ephemeral_5m_input_tokens: 2000,
          },
        },
      },
      'claude-opus-5',
    );
    expect(r.cacheWriteTokens).toBe(12000);
    expect(r.cacheWrite1hTokens).toBe(10000);
    expect(r.providerEstimatedCostUsd).toBeCloseTo(
      (500 * 5 + 50 * 25 + 2000 * 6.25 + 10000 * 10) / 1e6,
      9,
    );
  });

  it('unknown shape → unreported, unknown model → no cost', () => {
    expect(usageValues({}, 'claude-opus-5')).toEqual({
      inputTokens: null,
      outputTokens: null,
      cachedTokens: null,
      cacheWriteTokens: null,
      cacheWrite1hTokens: null,
      providerEstimatedCostUsd: null,
    });
    expect(
      usageValues({ usage: { input_tokens: 10, output_tokens: 1 } }, 'other')
        .providerEstimatedCostUsd,
    ).toBeNull();
  });
});
