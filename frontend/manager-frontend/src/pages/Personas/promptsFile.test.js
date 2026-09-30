import { describe, it, expect } from 'vitest';
import { buildPromptsFile, promptsFileName, readPromptsFile, PROMPTS_FILE_KIND } from './promptsFile';

const KEYS = ['intro', 'author_rules', 'opener'];
const persona = { slug: 'nastya', name: 'Настя' };

describe('выгрузка промптов в файл', () => {
  it('шапка, все ключи движка и порядок — из кода, а не из объекта', () => {
    const doc = buildPromptsFile(persona, { opener: 'Привет', intro: 'Ты {name}' }, KEYS);
    expect(doc.kind).toBe(PROMPTS_FILE_KIND);
    expect(doc.persona).toEqual({ slug: 'nastya', name: 'Настя' });
    expect(Object.keys(doc.prompts)).toEqual(KEYS);
    expect(doc.prompts.author_rules).toBe('');
    expect(doc.prompts.intro).toBe('Ты {name}');
  });

  it('имя файла — с личностью и датой', () => {
    expect(promptsFileName(persona, new Date(2026, 8, 12))).toBe('prompts-nastya-2026-09-12.json');
    expect(promptsFileName({ slug: 'лена и коля' }, new Date(2026, 0, 3))).toBe('prompts-persona-2026-01-03.json');
  });
});

describe('загрузка промптов из файла', () => {
  const file = (body) => JSON.stringify(body);

  it('свой файл разбирается целиком', () => {
    const doc = buildPromptsFile(persona, { intro: 'а', author_rules: 'б', opener: 'в' }, KEYS);
    const parsed = readPromptsFile(file(doc), KEYS);
    expect(parsed.prompts).toEqual({ intro: 'а', author_rules: 'б', opener: 'в' });
    expect(parsed.from).toBe('Настя');
    expect(parsed.skipped).toEqual([]);
  });

  it('голый объект тоже принимается — файл можно собрать руками', () => {
    const parsed = readPromptsFile(file({ opener: 'Привет' }), KEYS);
    expect(parsed.prompts).toEqual({ opener: 'Привет' });
    expect(parsed.from).toBeNull();
  });

  it('чужие ключи и не-строки не роняют загрузку, но названы поимённо', () => {
    const parsed = readPromptsFile(file({ opener: 'Привет', openr: 'опечатка', intro: 5 }), KEYS);
    expect(parsed.prompts).toEqual({ opener: 'Привет' });
    expect(parsed.skipped.sort()).toEqual(['intro', 'openr']);
  });

  it('файл другой личности берётся, и видно, чей он', () => {
    const doc = buildPromptsFile({ slug: 'lena', name: 'Лена' }, { opener: 'Привет' }, KEYS);
    expect(readPromptsFile(file(doc), KEYS).from).toBe('Лена');
  });

  it('не наш файл, мусор и пустота — понятная ошибка, а не пустой экран', () => {
    expect(() => readPromptsFile('{не json', KEYS)).toThrow(/не разбирается/);
    expect(() => readPromptsFile('[1,2]', KEYS)).toThrow(/объект/);
    expect(() => readPromptsFile(file({ kind: 'nastya.beats', prompts: {} }), KEYS)).toThrow(/nastya\.beats/);
    expect(() => readPromptsFile(file({ nope: 'x' }), KEYS)).toThrow(/ни одного знакомого/);
  });
});
