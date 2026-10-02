// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { cleanTriggers } from './Settings';

describe('стоп-фразы: чистка списка перед сохранением', () => {
  it('убирает пустые строки и дубли без учёта регистра и ё', () => {
    expect(cleanTriggers([' Менеджер ', 'менеджер', 'МЕНЕДЖЁР', '', '  ', 'Оператор'])).toEqual([
      'Менеджер',
      'Оператор',
    ]);
  });

  it('сжимает пробелы внутри фразы', () => {
    expect(cleanTriggers(['позови   менеджера'])).toEqual(['позови менеджера']);
  });
});
