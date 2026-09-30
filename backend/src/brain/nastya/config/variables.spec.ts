import {
  chatVariables,
  fillVariables,
  placeholdersIn,
  variableErrors,
  variableValues,
} from './variables';

describe('переменные личности', () => {
  const vars = variableValues({
    site: 'beboo',
    _site: 'сайт знакомств',
    город: 'Пхукет',
  });

  it('значения без пояснений, русские имена тоже', () => {
    expect(vars).toEqual({ site: 'beboo', город: 'Пхукет' });
  });

  it('подстановка на любой глубине, ключи объектов не трогаются', () => {
    const doc = {
      opener: 'Привет, это Настя с {site}',
      card: ['живу: {город}'],
      nested: { '{site}': '{site}' },
    };
    expect(fillVariables(doc, vars)).toEqual({
      opener: 'Привет, это Настя с beboo',
      card: ['живу: Пхукет'],
      nested: { '{site}': 'beboo' },
    });
  });

  it('незнакомые скобки и JSON в промптах судей остаются как есть', () => {
    const judge =
      'Верни JSON: {"intent":"смысл"} и {unknown} не трогай, {site} подставь';
    expect(fillVariables(judge, vars)).toBe(
      'Верни JSON: {"intent":"смысл"} и {unknown} не трогай, beboo подставь',
    );
  });

  it('встроенное имя подставляется как обычная переменная', () => {
    expect(
      fillVariables('Ты {name} с {site}', { ...vars, name: 'Настя' }),
    ).toBe('Ты Настя с beboo');
  });

  it('без переменных документ возвращается тем же объектом — лишней копии нет', () => {
    const doc = { a: '{site}' };
    expect(fillVariables(doc, {})).toBe(doc);
  });

  it('панель находит, где переменная используется', () => {
    expect(placeholdersIn('с {site} в {город}, {"json":1}')).toEqual([
      'site',
      'город',
    ]);
  });

  it('город и сайт диалога — из карточки лида, пустые не перекрывают запасное значение', () => {
    expect(
      chatVariables({ city: ' Омск ', site: 'mamba', name: 'Олег' }),
    ).toEqual({ city: 'Омск', site: 'mamba', interlocutor_city: 'Омск' });
    expect(chatVariables({ city: '', site: null })).toEqual({
      interlocutor_city: '',
    });
    expect(chatVariables(null)).toEqual({ interlocutor_city: '' });
    const merged = {
      ...vars,
      ...chatVariables({ site: 'mamba' }),
      name: 'Настя',
    };
    expect(fillVariables('Привет, это {name} с {site}', merged)).toBe(
      'Привет, это Настя с mamba',
    );
    expect(
      fillVariables('Привет, это {name} с {site}', {
        ...vars,
        ...chatVariables({}),
        name: 'Настя',
      }),
    ).toBe('Привет, это Настя с beboo');
  });

  it('проверка называет ошибки словами', () => {
    expect(variableErrors({ site: 'beboo', _site: 'пояснение' })).toEqual([]);
    const errors = variableErrors({
      '1site': 'x',
      name: 'Лена',
      age: 5,
      'with space': 'x',
    }).join(' | ');
    expect(errors).toMatch(/«1site»: имя/);
    expect(errors).toMatch(/\{name\}» встроенная/);
    expect(errors).toMatch(/«age»: значение — текст/);
    expect(errors).toMatch(/«with space»: имя/);
    expect(variableErrors([])).toEqual(['переменные — объект «имя: значение»']);
  });
});

it('client travel changes their current city without rewriting the persona hometown', () => {
  expect(
    chatVariables({ city: 'Казань', _persona_home_city: 'Пермь' }),
  ).toEqual({ city: 'Пермь', interlocutor_city: 'Казань' });
  expect(chatVariables({ _persona_home_city: 'Пермь' })).toEqual({
    city: 'Пермь',
    interlocutor_city: '',
  });
});
