import {
  addLead,
  costPerStep,
  heatmap,
  reachedSteps,
  sliceBy,
  speedOf,
  zeroFunnel,
  type CohortLead,
} from './insights';

const lead = (extra: Partial<CohortLead> = {}): CohortLead => ({
  persona: 'nastya',
  owner: 1,
  source: 'leadget',
  account: 7,
  cold: false,
  chatId: '100',
  replied: false,
  reached: [],
  ...extra,
});

describe('срезы статистики', () => {
  it('поздний этап засчитывает ранние; этап без ответа считается ответом', () => {
    expect([...reachedSteps(['lead'])]).toEqual([
      'vbros',
      'predloga',
      'soglas',
      'lead',
    ]);
    const f = zeroFunnel();
    addLead(f, lead());
    addLead(f, lead({ replied: true }));
    addLead(f, lead({ reached: ['deposit'] }));
    expect(f).toEqual({
      written: 3,
      replied: 2,
      soglas: 1,
      lead: 1,
      deposit: 1,
    });
  });

  it('разрез: строки по ключу, деньги по чатам, сортировка по числу написанных', () => {
    const rows = sliceBy(
      [
        lead({ persona: 'denis', chatId: '1' }),
        lead({ chatId: '2', replied: true }),
        lead({ chatId: '3' }),
      ],
      (l) => l.persona ?? '—',
      (k) => k.toUpperCase(),
      new Map([
        ['1', 0.5],
        ['2', 0.25],
        ['3', 0.125],
      ]),
    );
    expect(
      rows.map((r) => [r.key, r.label, r.written, r.replied, r.cost_usd]),
    ).toEqual([
      ['nastya', 'NASTYA', 2, 1, 0.375],
      ['denis', 'DENIS', 1, 0, 0.5],
    ]);
  });

  it('два лида одного чата: деньги чата в строке разреза считаются один раз', () => {
    const rows = sliceBy(
      [lead({ chatId: '1' }), lead({ chatId: '1', replied: true })],
      () => 'all',
      (k) => k,
      new Map([['1', 2]]),
    );
    expect(rows).toEqual([
      expect.objectContaining({ written: 2, replied: 1, cost_usd: 2 }),
    ]);
  });

  it('стоимость результата: деньги / число на шаге; пустой шаг — null', () => {
    expect(
      costPerStep(
        { written: 4, replied: 2, soglas: 1, lead: 0, deposit: 0 },
        2,
      ),
    ).toEqual({
      written: 0.5,
      replied: 1,
      soglas: 2,
      lead: null,
      deposit: null,
    });
  });

  it('тепловая карта: понедельник первой строкой, воскресенье последней', () => {
    const grid = heatmap([
      { dow: 1, hour: 9, n: 3 },
      { dow: 0, hour: 23, n: 2 },
    ]);
    expect(grid).toHaveLength(7);
    expect(grid[0][9]).toBe(3);
    expect(grid[6][23]).toBe(2);
  });

  it('скорость: округление до секунд, пусто — null', () => {
    expect(speedOf({ median: 61.6, p90: 300.2, n: 5n })).toEqual({
      median_s: 62,
      p90_s: 300,
      n: 5,
    });
    expect(speedOf(undefined)).toEqual({ median_s: null, p90_s: null, n: 0 });
  });
});
