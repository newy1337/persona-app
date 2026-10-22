import {
  allowedTypos,
  confusable,
  editDistance,
  matchTrigger,
  normalizeTriggers,
  normalizeTriggerText,
  stemOf,
  typoDistance,
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

  it('короткие слова только точно, и «опера» с «оператором» — разные слова', () => {
    // другое слово с тем же началом — не совпадение
    expect(matchTrigger('нужен оператор', ['опера'])).toBeNull();
    expect(matchTrigger('люблю оперу', ['опера'])).toBe('опера');
    expect(matchTrigger('ходил в оперу', ['оператор'])).toBeNull();
    expect(matchTrigger('это боты?', ['бот'])).toBeNull();
    expect(matchTrigger('ты бот?', ['бот'])).toBe('бот');
  });

  it('фраза из нескольких слов ищется подряд, с опечатками в любом слове', () => {
    expect(
      matchTrigger('слушай, пазови миниджера плиз', ['позови менеджера']),
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

  it('другое слово с тем же началом или одной непохожей буквой — не совпадение', () => {
    const t = ['позвонить'];
    for (const text of [
      'болит позвоночник',
      'можно позволить себе',
      'сломал позвонок',
      'трещина позвонка',
      'позвонки болят',
      'позвоночный столб',
    ])
      expect(matchTrigger(text, t)).toBeNull();
  });

  it('формы того же слова и опечатки подходят', () => {
    const t = ['позвонить'];
    for (const text of [
      'можно позвонить?',
      'позвоните мне',
      'позвоню вечером',
      'ты позвонишь?',
      'позвонила вчера',
      'давай позвони',
      'позвонили бы',
      'пазвонить можно',
      'позвонтиь',
      'позвонить',
    ])
      expect(matchTrigger(text, t)).toBe('позвонить');
    expect(matchTrigger('позовите менеджера', ['позови менеджера'])).toBe(
      'позови менеджера',
    );
    expect(matchTrigger('нужна помощь', ['помощь'])).toBe('помощь');
    expect(matchTrigger('без помощи никак', ['помощь'])).toBe('помощь');
  });

  // Случаи из срабатываний на проде: слово клиента → должно ли сработать
  it('реальные срабатывания «созвон»: формы того же слова — да, чужие слова — нет', () => {
    const t = ['созвон'];
    for (const w of [
      'созвон',
      'созвона',
      'созвоне',
      'созвоном',
      'созвоны',
      'созвонов',
      'созвонимся',
      'созвонится',
      'созвониться',
      'созвонился',
      'созваниваемся',
      'созванивались',
      'созваниваться',
      'созваниваешься',
      'созваниваюсь',
    ])
      expect([w, matchTrigger(`давай ${w}`, t)]).toEqual([w, 'созвон']);
    for (const w of [
      'позвоночника',
      'позвонить',
      'позвоню',
      'позвонил',
      'позвони',
      'дозвон',
      'дозвонился',
      'сезон',
      'созвездие',
    ])
      expect([w, matchTrigger(`вот ${w}`, t)]).toEqual([w, null]);
  });

  it('реальные срабатывания «позвонить»: «позволить», «подводить» — нет', () => {
    const t = ['позвонить'];
    for (const w of ['позволить', 'позволишь', 'подводить', 'позвоночника'])
      expect([w, matchTrigger(`вот ${w}`, t)]).toEqual([w, null]);
    for (const w of ['позвонить', 'позвонишь', 'позванивать'])
      expect([w, matchTrigger(`вот ${w}`, t)]).toEqual([w, 'позвонить']);
  });

  it('опечатки — только похожие буквы и не больше одного пропуска', () => {
    expect(typoDistance('позволить', 'позвонить', 2)).toBe(3);
    expect(typoDistance('мынеджер', 'менеджер', 2)).toBe(1);
    expect(typoDistance('менджер', 'менеджер', 2)).toBe(1);
    expect(typoDistance('мненеджер', 'менеджер', 2)).toBe(1);
    expect(typoDistance('мнеджер', 'менеджер', 2)).toBe(1);
    expect(confusable('н', 'л')).toBe(false);
    expect(confusable('н', 'г')).toBe(true);
    expect(confusable('е', 'ы')).toBe(true);
    expect(stemOf('позвонить').stem).toBe('позвон');
    expect(stemOf('менеджера').stem).toBe('менеджер');
  });

  it('нормализация текста', () => {
    expect(normalizeTriggerText('  Ёж  в\tлесу ')).toBe('еж в лесу');
  });
});
