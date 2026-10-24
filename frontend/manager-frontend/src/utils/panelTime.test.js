import { describe, expect, it } from 'vitest';
import { rangeForFilter } from './panelTime';

const now = new Date('2026-10-08T10:00:00+03:00');

describe('период для плиток дашборда', () => {
  it('пресеты считаются по московским дням', () => {
    expect(rangeForFilter('', now)).toEqual({});
    expect(rangeForFilter('today', now)).toEqual({ from: '2026-10-08', to: '2026-10-08' });
    expect(rangeForFilter('yesterday', now)).toEqual({ from: '2026-10-07', to: '2026-10-07' });
    expect(rangeForFilter('7d', now)).toEqual({ from: '2026-10-02', to: '2026-10-08' });
    expect(rangeForFilter('30d', now)).toEqual({ from: '2026-09-09', to: '2026-10-08' });
    expect(rangeForFilter('date:2026-10-01', now)).toEqual({ from: '2026-10-01', to: '2026-10-01' });
  });

  it('после полуночи по Москве, но до полуночи UTC — уже новый день', () => {
    const late = new Date('2026-10-08T22:30:00Z');
    expect(rangeForFilter('today', late)).toEqual({ from: '2026-10-09', to: '2026-10-09' });
  });
});
