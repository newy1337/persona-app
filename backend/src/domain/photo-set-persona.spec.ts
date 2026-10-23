import { autoPersonaFor, autoPersonas } from './photo-set-persona';

const artist = { slug: 'artist', name: 'Артем' };
const artem = { slug: 'artem', name: 'Артемт' };
const vitalik = { slug: 'vitalik', name: 'Виталик' };
const alina = { slug: 'alina', name: 'Алина' };

describe('автопривязка образа к личности', () => {
  it('у сотрудника одна личность — образ сразу на неё', () => {
    expect(autoPersonaFor('Зима', [alina], new Set())).toBe('alina');
  });

  it('личностей несколько — по имени образа', () => {
    expect(autoPersonaFor('Артем', [artist, vitalik], new Set())).toBe(
      'artist',
    );
    expect(autoPersonaFor('Алина — осень', [alina, vitalik], new Set())).toBe(
      'alina',
    );
    expect(autoPersonaFor('виталик/город', [alina, vitalik], new Set())).toBe(
      'vitalik',
    );
  });

  it('похожие имена не путаются: «Артем» ≠ «Артемт»', () => {
    expect(autoPersonaFor('Артем', [artist, artem], new Set())).toBe('artist');
    expect(autoPersonaFor('Артемт лето', [artist, artem], new Set())).toBe(
      'artem',
    );
  });

  it('неоднозначно или имя не совпало — в запас', () => {
    expect(autoPersonaFor('Зима', [alina, vitalik], new Set())).toBeNull();
  });

  it('у личности уже есть образ — новый не забирает её сам', () => {
    expect(
      autoPersonaFor('Алина 2', [alina, vitalik], new Set(['alina'])),
    ).toBeNull();
    expect(autoPersonaFor('Зима', [alina], new Set(['alina']))).toBeNull();
  });

  it('пачка: вторая «Надя» уходит в запас, «Денис» — на Дениса', () => {
    const nadya = { slug: 'nadya', name: 'Надя' };
    const denis = { slug: 'denis', name: 'Денис' };
    const r = autoPersonas(
      [
        { id: 1, name: 'Надя — образ 1' },
        { id: 2, name: 'Надя — образ 2' },
        { id: 3, name: 'Денис — город' },
      ],
      [denis, nadya],
      [],
    );
    expect([...r]).toEqual([
      [1, 'nadya'],
      [2, null],
      [3, 'denis'],
    ]);
  });
});
