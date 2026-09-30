import { DEFAULT_TYPING, partPauseMs, typingMs, typingPlan } from './typing';

const mid = () => 0.5;
const S = DEFAULT_TYPING;

describe('«печатает…» как в persona-chat', () => {
  it('время набора — от длины текста, но не меньше полутора секунд', () => {
    expect(typingMs('ок', S, mid)).toBe(1500);
    expect(typingMs('x'.repeat(120), S, mid)).toBeCloseTo(10250, 0);
    expect(typingMs('x'.repeat(120), S, () => 0)).toBeCloseTo(7500, 0);
    expect(typingMs('x'.repeat(120), S, () => 1)).toBeCloseTo(13000, 0);
  });

  it('короткое — один заход, среднее — два, длинное — три; между заходами статус снимается', () => {
    expect(typingPlan('привет) как сам?', S, mid)).toEqual({
      bursts: [1500],
      pauses: [],
    });

    const medium = typingPlan('x'.repeat(50), S, mid);
    expect(medium.bursts).toHaveLength(2);
    expect(medium.pauses).toHaveLength(1);
    expect(medium.bursts[0]).toBeGreaterThan(medium.bursts[1]);

    const long = typingPlan('x'.repeat(200), S, mid);
    expect(long.bursts).toHaveLength(3);
    expect(long.pauses).toHaveLength(2);
    for (const pause of long.pauses) {
      expect(pause).toBeGreaterThanOrEqual(800);
      expect(pause).toBeLessThanOrEqual(2200);
    }
  });

  it('заход не короче 0,7 с — иначе статус не успеет показаться', () => {
    const plan = typingPlan(
      'x'.repeat(40),
      { ...S, chars_per_second: 12, min_seconds: 0 },
      () => 0,
    );
    for (const burst of plan.bursts) expect(burst).toBeGreaterThanOrEqual(700);
  });

  it('пауза между частями реплики — в заданных пределах, перевёрнутые пределы не ломают', () => {
    expect(partPauseMs(S, () => 0)).toBe(1500);
    expect(partPauseMs(S, () => 1)).toBe(4000);
    expect(
      partPauseMs({ ...S, part_pause_min: 4, part_pause_max: 1.5 }, () => 0),
    ).toBe(1500);
  });
});
