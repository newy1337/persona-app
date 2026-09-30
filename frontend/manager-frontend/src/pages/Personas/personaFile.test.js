import { describe, it, expect } from 'vitest';
import { personaFileName, readPersonaFile } from './personaFile';

const KEYS = ['prompts', 'persona', 'goals', 'storylines', 'dayConfig', 'beats'];
const file = (body) => JSON.stringify(body);

const bundle = {
  kind: 'nastya.persona',
  version: 1,
  persona: { slug: 'lena', name: 'Лена' },
  exported_at: '2026-09-12T10:00:00.000Z',
  sections: {
    persona: { name: 'Лена', card: ['факт'] },
    goals: { stages: [] },
    storylines: { lines: [] },
    dayConfig: {},
    beats: null,
    prompts: { opener: 'Привет' },
  },
};

describe('имя файла личности', () => {
  it('с идентификатором и датой', () => {
    expect(personaFileName({ slug: 'nastya' }, new Date(2026, 8, 12))).toBe('persona-nastya-2026-09-12.json');
  });
});

describe('разбор файла личности', () => {
  it('файл выгрузки разбирается целиком, включая пустые биты', () => {
    const parsed = readPersonaFile(file(bundle), KEYS);
    expect(Object.keys(parsed.sections).sort()).toEqual([...KEYS].sort());
    expect(parsed.sections.beats).toBeNull();
    expect(parsed.from).toBe('Лена');
    expect(parsed.skipped).toEqual([]);
  });

  it('частичный файл правит часть — остальные секции в него не попадают', () => {
    const parsed = readPersonaFile(file({ sections: { prompts: { opener: 'Привет' } } }), KEYS);
    expect(Object.keys(parsed.sections)).toEqual(['prompts']);
  });

  it('голый набор секций тоже принимается — файл можно собрать руками', () => {
    const parsed = readPersonaFile(file({ goals: { stages: [] }, beats: [{ id: 'B1' }] }), KEYS);
    expect(Object.keys(parsed.sections).sort()).toEqual(['beats', 'goals']);
  });

  it('шапка голого файла не уезжает в секции', () => {
    const parsed = readPersonaFile(file({ kind: 'nastya.persona', version: 1, goals: {} }), KEYS);
    expect(Object.keys(parsed.sections)).toEqual(['goals']);
    expect(readPersonaFile(file(bundle), KEYS).sections.persona.card).toEqual(['факт']);
  });

  it('незнакомые секции названы поимённо, а не выброшены молча', () => {
    const parsed = readPersonaFile(file({ goals: {}, voice: { rate: 1 } }), KEYS);
    expect(parsed.skipped).toEqual(['voice']);
  });

  it('файл промптов отправляет на свою вкладку, чужой — ошибка', () => {
    expect(() => readPersonaFile(file({ kind: 'nastya.prompts', prompts: {} }), KEYS)).toThrow(/вкладке/);
    expect(() => readPersonaFile(file({ kind: 'что-то' }), KEYS)).toThrow(/не личность/);
    expect(() => readPersonaFile('{битый', KEYS)).toThrow(/не разбирается/);
    expect(() => readPersonaFile(file({ voice: {} }), KEYS)).toThrow(/ни одной знакомой/);
  });

  it('сломанная форма секции — ошибка до отправки, а не 422 с сервера', () => {
    expect(() => readPersonaFile(file({ goals: [1, 2] }), KEYS)).toThrow(/«goals» — объект/);
    expect(() => readPersonaFile(file({ beats: { a: 1 } }), KEYS)).toThrow(/«beats» — массив/);
  });
});
