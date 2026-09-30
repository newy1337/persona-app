import { describe, it, expect } from 'vitest';
import { BARS, fallbackPeaks, fmtClock, peaksFromSamples, seekRatio } from './voiceWave';

describe('волна голосового', () => {
  it('время как в Telegram', () => {
    expect(fmtClock(6.4)).toBe('0:06');
    expect(fmtClock(65)).toBe('1:05');
    expect(fmtClock(Infinity)).toBe('0:00');
    expect(fmtClock(NaN)).toBe('0:00');
  });

  it('громкие куски — высокие столбики, тишина — короткая чёрточка', () => {
    const samples = new Float32Array(3600);
    samples.fill(0.8, 0, 1800);
    const peaks = peaksFromSamples(samples, 36);
    expect(peaks).toHaveLength(36);
    expect(peaks[0]).toBeCloseTo(1, 5);
    expect(peaks[35]).toBeCloseTo(0.12, 5);
  });

  it('заглушка стабильна для одного файла и в пределах высоты', () => {
    const a = fallbackPeaks('/api/files/1');
    expect(a).toEqual(fallbackPeaks('/api/files/1'));
    expect(a).toHaveLength(BARS);
    expect(a.every((h) => h >= 0.25 && h <= 0.85)).toBe(true);
  });

  it('перемотка по клику — доля ширины', () => {
    const rect = { left: 100, width: 200 };
    expect(seekRatio(200, rect)).toBe(0.5);
    expect(seekRatio(50, rect)).toBe(0);
    expect(seekRatio(400, rect)).toBe(1);
  });
});
