import { goalStats } from './goal-stats';

const persona = {
  slug: 'nastya',
  name: 'Настя',
  variables: '{}',
  goals: JSON.stringify({
    slots: [
      { id: 'name', name: 'Имя', hint: 'как тебя зовут?' },
      { id: 'age', topic: 'Сколько лет; примерно' },
      { id: 'pets' },
    ],
  }),
};

describe('goalStats', () => {
  it('доля диалогов личности, где цель узнана, и средний процент', () => {
    const [row] = goalStats(
      [persona],
      new Map([['nastya', 4]]),
      new Map([
        [
          'nastya',
          new Map([
            ['name', 4],
            ['age', 1],
            ['old', 3],
          ]),
        ],
      ]),
    );
    expect(row.chats).toBe(4);
    expect(row.goals.map((g) => [g.id, g.title, g.known, g.percent])).toEqual([
      ['name', 'Имя', 4, 100],
      ['age', 'age', 1, 25],
      ['pets', 'pets', 0, 0],
    ]);
    // (4 + 1 + 0) / (4 × 3) — цель «old» из старых настроек не считается
    expect(row.percent).toBe(41.7);
  });

  it('личность без настроек в базе — по slug и без целей', () => {
    const [row] = goalStats([], new Map([['ghost', 2]]), new Map());
    expect(row).toMatchObject({
      name: 'ghost',
      chats: 2,
      percent: 0,
      goals: [],
    });
  });
});
