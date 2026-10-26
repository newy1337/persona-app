import { describe, expect, it } from 'vitest';
import { validateSection } from './validate';

describe('проверка документов личности', () => {
  it('цели: повтор id и ссылка на несуществующую тему', () => {
    const doc = {
      stages: [{ id: 'knock', ask_slots: ['work', 'pets'] }, { id: 'knock', ask_slots: [] }],
      slots: [{ id: 'work', topic: 'работа' }, { id: 'age' }],
    };
    expect(validateSection('goals', doc)).toEqual([
      'Цели: этап «knock» встречается дважды',
      'Цели: этап «knock» спрашивает тему «pets», а такой темы нет',
      'Цели: у темы «age» нет названия (topic)',
    ]);
  });

  it('сюжеты: линия без шагов и пустой шаг', () => {
    expect(validateSection('storylines', { lines: [{ id: 'a', beats: [] }, { id: 'b', beats: ['x', ' '] }] })).toEqual([
      'Сюжеты: у линии «a» нет шагов — бот её не расскажет',
      'Сюжеты: у линии «b» есть пустой шаг',
    ]);
  });

  it('биты: повтор, без названия, день не число, неизвестный вид', () => {
    expect(validateSection('beats', [{ id: 'B1', title: 'а', day: 0 }, { id: 'B1', title: '', day: 'завтра', scope: 'x' }])).toEqual([
      'Биты: «B1» встречается дважды',
      'Биты: у бита «B1» нет названия',
      'Биты: у бита «B1» день не число',
      'Биты: у бита «B1» неизвестный вид «x»',
    ]);
  });

  it('правильные документы и прочие разделы — без предупреждений', () => {
    expect(validateSection('goals', { stages: [{ id: 'k', ask_slots: ['w'] }], slots: [{ id: 'w', topic: 'работа' }] })).toEqual([]);
    expect(validateSection('dayConfig', { anything: 1 })).toEqual([]);
  });
});

import { itemTitle } from './fields';

describe('подпись свёрнутого пункта', () => {
  it('id, название и день; без названия — как раньше', () => {
    expect(itemTitle({ id: 'B2', title: 'Рассказ про Луну', day: 1 }, 0)).toBe('B2 · Рассказ про Луну · день 1');
    expect(itemTitle({ id: 'work', topic: 'работа' }, 0)).toBe('work · работа');
    expect(itemTitle({ id: 'x' }, 0)).toBe('x');
    expect(itemTitle({}, 2)).toBe('3');
  });
});
