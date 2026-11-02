import {
  datingSiteOf,
  leadSlots,
  openerText,
  SITE_FALLBACK,
  openerVariants,
  pickOpener,
} from './outreach-opener';
import { DEFAULT_PROMPTS } from '../brain/config/prompts';

describe('outreach opener', () => {
  it('the default first line names the persona, not a fixed one', () => {
    expect(DEFAULT_PROMPTS.opener).toBe('Привет, это {name} с {site}');
  });

  it('the dating site comes from the persona card', () => {
    expect(datingSiteOf({ dating_site: 'mamba' })).toBe('mamba');
    expect(datingSiteOf({})).toBe('beboo');
  });

  it('lead card → character slots', () => {
    expect(
      leadSlots({ firstName: 'Олег', city: 'Москва', age: 34 }, 'mamba'),
    ).toEqual({
      dating_site: 'mamba',
      name: 'Олег',
      age: '34',
      location: 'Москва',
    });
    expect(leadSlots({})).toEqual({ dating_site: 'beboo' });
  });
});

describe('первое сообщение лиду', () => {
  const vars = { name: 'Денис', city: 'Мадрид' };

  it('подставляет имя личности и сайт лида', () => {
    expect(openerText('Привет, это {name} с {site}', vars, 'mamba')).toBe(
      'Привет, это Денис с mamba',
    );
  });

  it('сайт неизвестен — пишем общими словами, а не фигурными скобками', () => {
    expect(openerText('Привет, это {name} с {site}', vars, '')).toBe(
      `Привет, это Денис с ${SITE_FALLBACK}`,
    );
  });

  it('свой текст личности остаётся как есть', () => {
    expect(openerText('Доброе утро)', vars, '')).toBe('Доброе утро)');
  });
});

describe('пул первых сообщений', () => {
  const pool =
    'Привет, это {name}\n---\nПриветик) {name} с {site}\n  ---  \n\n---\nДобрый вечер!';

  it('варианты через строку «---»; пустые не считаются; без разделителя — один', () => {
    expect(openerVariants(pool)).toEqual([
      'Привет, это {name}',
      'Приветик) {name} с {site}',
      'Добрый вечер!',
    ]);
    expect(openerVariants('Привет, это {name} с {site}')).toEqual([
      'Привет, это {name} с {site}',
    ]);
    // тире внутри текста — не разделитель
    expect(openerVariants('Привет --- как дела?')).toEqual([
      'Привет --- как дела?',
    ]);
  });

  it('каждому лиду — случайный вариант из пула', () => {
    expect(pickOpener(pool, () => 0)).toBe('Привет, это {name}');
    expect(pickOpener(pool, () => 0.5)).toBe('Приветик) {name} с {site}');
    expect(pickOpener(pool, () => 0.999)).toBe('Добрый вечер!');
    const seen = new Set(Array.from({ length: 200 }, () => pickOpener(pool)));
    expect(seen.size).toBe(3);
  });
});
