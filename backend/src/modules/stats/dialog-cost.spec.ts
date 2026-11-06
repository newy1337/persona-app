import { costOfSums, dialogCost, stageCostSummary } from './dialog-cost';

describe('dialogCost', () => {
  const calls = [
    { at: 100, cost: 0.1 },
    { at: 200, cost: 0.2 },
    { at: 300, cost: 0.3 },
    { at: 400, cost: 0.4 },
  ];

  it('цена к этапу — всё, что потрачено до момента, когда этап поставили', () => {
    const r = dialogCost(calls, { vbros: 200, lead: 300 });
    expect(r.total_usd).toBeCloseTo(1.0);
    expect(r.calls).toBe(4);
    const by = Object.fromEntries(r.stages.map((s) => [s.stage, s]));
    expect(by.vbros.cost_usd).toBeCloseTo(0.3);
    expect(by.vbros.delta_usd).toBeCloseTo(0.3);
    expect(by.lead.cost_usd).toBeCloseTo(0.6);
    expect(by.lead.delta_usd).toBeCloseTo(0.3);
  });

  it('этап без времени — пустой; порядок этапов воронки, без архива', () => {
    const r = dialogCost(calls, { predloga: 'nope' });
    expect(r.stages.map((s) => s.stage)).toEqual([
      'vbros',
      'predloga',
      'soglas',
      'lead',
      'deposit',
    ]);
    expect(r.stages.every((s) => s.cost_usd === null)).toBe(true);
  });

  it('пустой чат стоит ноль', () => {
    expect(dialogCost([], {}).total_usd).toBe(0);
  });
});

describe('stageCostSummary', () => {
  it('средняя и медиана по чатам, дошедшим до этапа', () => {
    const rows = stageCostSummary([
      { stage: 'lead', cost: 1 },
      { stage: 'lead', cost: 3 },
      { stage: 'lead', cost: 2 },
      { stage: 'vbros', cost: 0.5 },
    ]);
    const lead = rows.find((r) => r.stage === 'lead')!;
    expect(lead.chats).toBe(3);
    expect(lead.avg_usd).toBe(2);
    expect(lead.median_usd).toBe(2);
    expect(rows.find((r) => r.stage === 'deposit')!.avg_usd).toBeNull();
  });
});

describe('costOfSums', () => {
  it('цена по токенам модели; неизвестная модель — ноль', () => {
    const price = (m: string) =>
      m === 'known'
        ? { input: 1, output: 2, cache_write: 1.25, cache_read: 0.1 }
        : null;
    const cost = costOfSums(
      [
        {
          model: 'known',
          input: 1_000_000,
          output: 500_000,
          cache_write: 0,
          cache_read: 0,
          cache_write_1h: 0,
        },
        {
          model: 'other',
          input: 9_000_000,
          output: 0,
          cache_write: 0,
          cache_read: 0,
          cache_write_1h: 0,
        },
      ],
      price as never,
    );
    expect(cost).toBeCloseTo(2);
  });
});
