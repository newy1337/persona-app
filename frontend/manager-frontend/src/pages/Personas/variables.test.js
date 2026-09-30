import { describe, it, expect } from 'vitest';
import { docFromRows, rowErrors, rowsFromDoc, usages } from './variables';

describe('переменные: строки и документ', () => {
  const doc = { site: 'beboo', _site: 'сайт знакомств', город: 'Пхукет' };

  it('документ → строки → тот же документ', () => {
    const rows = rowsFromDoc(doc);
    expect(rows).toEqual([
      { key: 'site', value: 'beboo', note: 'сайт знакомств' },
      { key: 'город', value: 'Пхукет', note: '' },
    ]);
    expect(docFromRows(rows)).toEqual(doc);
  });

  it('недописанная строка без имени не попадает в документ', () => {
    expect(docFromRows([{ key: '  ', value: 'x', note: '' }, { key: 'a', value: '', note: '' }])).toEqual({ a: '' });
  });

  it('ошибки имён — рядом со строкой', () => {
    const errors = rowErrors(
      [
        { key: 'site', value: '1' },
        { key: 'site', value: '2' },
        { key: '1x', value: '' },
        { key: 'name', value: 'Лена' },
        { key: '', value: 'без имени' },
        { key: '', value: '' },
      ],
      { name: 'имя личности' },
    );
    expect(errors).toEqual([null, 'такое имя уже есть', 'буквы, цифры и «_», не с цифры', 'встроенная: имя личности', 'нужно имя', null]);
  });

  it('где используется: по всем вкладкам, JSON-скобки не в счёт', () => {
    const map = usages({
      prompts: { opener: 'Привет, это {name} с {site}', judge_plan: 'Верни JSON: {"intent":"x"}' },
      persona: { card: ['живу: {город}', 'сайт {site}'] },
      variables: { site: '{site}' },
    });
    expect([...map.get('site')].sort()).toEqual(['persona', 'prompts']);
    expect([...map.get('город')]).toEqual(['persona']);
    expect(map.has('intent')).toBe(false);
  });
});
