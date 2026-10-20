import { allowedOwners } from './lead-owners';

const users = [
  { id: 1, leadId: null }, // хед
  { id: 2, leadId: 1 }, // тимлид
  { id: 3, leadId: 2 }, // менеджер под тимлидом
  { id: 4, leadId: 1 }, // менеджер напрямую под хедом
  { id: 5, leadId: null }, // чужой менеджер
];

describe('чьи лиды может писать аккаунт', () => {
  it('менеджер аккаунта и все руководители над ним', () => {
    expect([...allowedOwners([3], users)].sort()).toEqual([1, 2, 3]);
    expect([...allowedOwners([4], users)].sort()).toEqual([1, 4]);
  });

  it('чужая ветка не входит', () => {
    const allowed = allowedOwners([3], users);
    expect(allowed.has(4)).toBe(false);
    expect(allowed.has(5)).toBe(false);
  });

  it('несколько менеджеров на аккаунте объединяются', () => {
    expect([...allowedOwners([3, 5], users)].sort()).toEqual([1, 2, 3, 5]);
  });

  it('аккаунт без менеджеров — никто, цикл в данных не зависает', () => {
    expect(allowedOwners([], users).size).toBe(0);
    const loop = [
      { id: 1, leadId: 2 },
      { id: 2, leadId: 1 },
    ];
    expect([...allowedOwners([1], loop)].sort()).toEqual([1, 2]);
  });
});
