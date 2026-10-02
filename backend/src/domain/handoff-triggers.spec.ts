import {
  matchTrigger,
  normalizeTriggers,
  normalizeTriggerText,
} from './handoff-triggers';

describe('стоп-фразы для передачи менеджеру', () => {
  it('совпадение не зависит от регистра, ё и пробелов', () => {
    const triggers = ['Позови менеджера', 'живой человек'];
    expect(matchTrigger('ПОЗОВИ   менеджера пожалуйста', triggers)).toBe(
      'Позови менеджера',
    );
    expect(matchTrigger('ты живои человек?', triggers)).toBeNull();
    expect(matchTrigger('ты живой человек?', triggers)).toBe('живой человек');
  });

  it('ищет фразу внутри сообщения, а не только целиком', () => {
    expect(
      matchTrigger('слушай, а можно оператора позвать', ['оператор']),
    ).toBe('оператор');
  });

  it('пустой текст и пустой список — нет совпадения', () => {
    expect(matchTrigger('', ['а'])).toBeNull();
    expect(matchTrigger('что угодно', [])).toBeNull();
    expect(matchTrigger('что угодно', ['', '   '])).toBeNull();
  });

  it('список чистится от пустых и дублей, написание сохраняется', () => {
    expect(
      normalizeTriggers([
        ' Менеджер ',
        'менеджер',
        'МЕНЕДЖЁР',
        '',
        null,
        'Оператор',
      ]),
    ).toEqual(['Менеджер', 'Оператор']);
  });

  it('не массив — пустой список', () => {
    expect(normalizeTriggers('менеджер')).toEqual([]);
    expect(normalizeTriggers(undefined)).toEqual([]);
  });

  it('нормализация текста', () => {
    expect(normalizeTriggerText('  Ёж  в\tлесу ')).toBe('еж в лесу');
  });
});
