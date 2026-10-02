import {
  allowedTypos,
  editDistance,
  matchTrigger,
  normalizeTriggers,
  normalizeTriggerText,
  wordMatches,
} from './handoff-triggers';

describe('стоп-фразы для передачи менеджеру', () => {
  it('совпадение не зависит от регистра, ё и пробелов', () => {
    const triggers = ['Позови менеджера', 'живой человек'];
    expect(matchTrigger('ПОЗОВИ   менеджера пожалуйста', triggers)).toBe(
      'Позови менеджера',
    );
    expect(matchTrigger('ты живои человек?', triggers)).toBe('живой человек');
    expect(matchTrigger('ты живой человек?', triggers)).toBe('живой человек');
  });

  it('ищет фразу внутри сообщения, а не только целиком', () => {
    expect(
      matchTrigger('слушай, а можно оператора позвать', ['оператор']),
    ).toBe('оператор');
  });

  it('другое окончание того же слова подходит', () => {
    expect(matchTrigger('а менеджерка тут есть?', ['менеджер'])).toBe(
      'менеджер',
    );
    expect(matchTrigger('дайте оператора', ['оператор'])).toBe('оператор');
  });

  it('опечатки прощаются: одна на средних словах, две на длинных', () => {
    expect(matchTrigger('позови мынеджерка', ['менеджер'])).toBe('менеджер');
    expect(matchTrigger('ты робот или чиловек', ['человек'])).toBe('человек');
    expect(matchTrigger('нужен апиратор', ['оператор'])).toBe('оператор');
    expect(matchTrigger('нужен апиратар', ['оператор'])).toBeNull();
  });

  it('короткие слова только точно: «опера» не цепляет «оператора», «бот» не цепляет «боты»', () => {
    expect(matchTrigger('нужен оператор', ['опера'])).toBe('опера');
    expect(matchTrigger('ходил в оперу', ['оператор'])).toBeNull();
    expect(matchTrigger('это боты?', ['бот'])).toBeNull();
    expect(matchTrigger('ты бот?', ['бот'])).toBe('бот');
  });

  it('фраза из нескольких слов ищется подряд, с опечатками в любом слове', () => {
    expect(
      matchTrigger('слушай, пазави миниджера плиз', ['позови менеджера']),
    ).toBe('позови менеджера');
    expect(matchTrigger('менеджера позови', ['позови менеджера'])).toBeNull();
    expect(
      matchTrigger('позови лучше менеджера', ['позови менеджера']),
    ).toBeNull();
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

  it('порог опечаток и расстояние', () => {
    expect(allowedTypos('бот')).toBe(0);
    expect(allowedTypos('живой')).toBe(1);
    expect(allowedTypos('менеджер')).toBe(2);
    expect(editDistance('менеджер', 'мынеджер', 2)).toBe(1);
    expect(editDistance('кот', 'собака', 2)).toBeGreaterThan(2);
    expect(wordMatches('менеджерка', 'менеджер')).toBe(true);
    expect(wordMatches('опера', 'оператор')).toBe(false);
  });

  it('нормализация текста', () => {
    expect(normalizeTriggerText('  Ёж  в\tлесу ')).toBe('еж в лесу');
  });
});
