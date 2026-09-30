import { describe, expect, it } from 'vitest';
import { groupByMonth } from './MediaGallery';

describe('вкладка «Медиа»', () => {
  it('группы по месяцам — в порядке списка, с заглавной буквы', () => {
    const at = (y, m, d) => Math.floor(new Date(y, m, d, 12).getTime() / 1000);
    const groups = groupByMonth([{ ts: at(2026, 8, 17) }, { ts: at(2026, 8, 2) }, { ts: at(2026, 7, 30) }]);
    expect(groups.map((g) => [g.title, g.items.length])).toEqual([
      ['Сентябрь 2026 г.', 2],
      ['Август 2026 г.', 1],
    ]);
  });
});
