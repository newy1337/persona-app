import { describe, it, expect } from 'vitest';
import { stageColors, stageFilters } from './stages';

describe('этапы знакомства в списке диалогов', () => {
  const rows = [
    { chat_id: 1, stage: { id: 'smalltalk', title: 'разговорились', index: 2, total: 5 } },
    { chat_id: 2, stage: { id: 'knock', title: 'первое касание', index: 1, total: 5 } },
    { chat_id: 3, stage: { id: 'smalltalk', title: 'разговорились', index: 2, total: 5 } },
    { chat_id: 4, stage: null },
  ];

  it('фильтры — этапы, которые есть в списке, по порядку этапов и без повторов', () => {
    expect(stageFilters(rows).map((f) => f.label)).toEqual(['первое касание', 'разговорились']);
    expect(stageFilters([])).toEqual([]);
  });

  it('у разных этапов разный цвет, у одного этапа — один', () => {
    expect(stageColors(1).color).not.toBe(stageColors(2).color);
    expect(stageColors(2)).toEqual(stageColors(2));
    expect(stageColors(99).color).toMatch(/^#/);
  });
});
