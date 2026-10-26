import {
  floodRetryAfter,
  cityOf,
  isCityName,
  mskDayStart,
  normalizePhone,
  normalizeUsername,
  normalizeVkUsername,
  parseLeadContact,
  parseLeadLines,
  withinOutreachHours,
} from './leads';

describe('leads domain', () => {
  it('город без цифр: «38» — возраст не в том поле, строка импорта с ним — ошибка', () => {
    expect(isCityName('Москва')).toBe(true);
    expect(isCityName('38')).toBe(false);
    expect(isCityName('Москва 2')).toBe(false);
    expect(isCityName('')).toBe(false);
    expect(isCityName(null)).toBe(false);
    expect(cityOf(' Омск ')).toBe('Омск');
    expect(cityOf('')).toBeNull();
    expect(() => cityOf('38')).toThrow('не может быть цифр');
    const r = parseLeadLines('+79001234567;Олег;38\n+79001234568;Ира;Пермь;30');
    expect(r.items.map((i) => i.city)).toEqual(['Пермь']);
    expect(r.errors).toEqual([
      expect.stringContaining('строка 1: в поле «Город» не может быть цифр'),
    ]);
  });

  it('parses VK pages: links, idN, bare numbers and short names with dots', () => {
    expect(normalizeVkUsername('https://vk.com/id12345')).toBe('id12345');
    expect(normalizeVkUsername('m.vk.com/Ivan.Petrov?from=search')).toBe(
      'ivan.petrov',
    );
    expect(normalizeVkUsername('vk.ru/durov')).toBe('durov');
    expect(normalizeVkUsername('@durov')).toBe('durov');
    expect(normalizeVkUsername('12345')).toBe('id12345');
    expect(normalizeVkUsername('..')).toBeNull();
    expect(normalizeVkUsername('ab')).toBeNull();
    expect(normalizeVkUsername('кириллица')).toBeNull();
  });

  it('a vk.com link makes a VK lead whatever the form says; t.me — Telegram', () => {
    expect(parseLeadContact('vk.com/durov')).toEqual({
      username: 'durov',
      phone_e164: null,
      channel: 'vk',
    });
    expect(parseLeadContact('t.me/some_name', 'vk')).toEqual({
      username: 'some_name',
      phone_e164: null,
      channel: 'telegram',
    });
    expect(parseLeadContact('ivan.petrov', 'vk')?.username).toBe('ivan.petrov');
    expect(parseLeadContact('ivan.petrov', 'telegram')).toBeNull();
    expect(parseLeadContact('123456789', 'vk')?.username).toBe('id123456789');
    expect(parseLeadContact('1012345678', 'vk')?.username).toBe('id1012345678');
    expect(parseLeadContact('9001234567', 'vk')?.phone_e164).toBe(
      '+79001234567',
    );
    expect(parseLeadContact('89001234567', 'vk')?.phone_e164).toBe(
      '+79001234567',
    );
    expect(parseLeadContact('123456789', 'telegram')).toBeNull();
    expect(parseLeadContact('+7 900 123-45-67', 'vk')).toEqual({
      phone_e164: '+79001234567',
      username: null,
      channel: 'vk',
    });
    const lines = parseLeadLines(
      'vk.com/durov;Паша\n+79001234567\n@nick_one',
      'vk',
    );
    expect(
      lines.items.map((i) => [i.channel, i.username ?? i.phone_e164]),
    ).toEqual([
      ['vk', 'durov'],
      ['vk', '+79001234567'],
      ['vk', 'nick_one'],
    ]);
  });

  it('normalises phones to E.164', () => {
    expect(normalizePhone('+7 (900) 123-45-67')).toBe('+79001234567');
    expect(normalizePhone('8 900 1234567')).toBe('+79001234567');
    expect(normalizePhone('79001234567')).toBe('+79001234567');
    expect(normalizePhone('12025550123')).toBe('+12025550123');
    expect(normalizePhone('9123456702')).toBe('+79123456702');
    expect(normalizePhone('-7-912-345-67-02')).toBe('+79123456702');
    expect(normalizePhone('123')).toBeNull();
    expect(normalizePhone('')).toBeNull();
  });

  it('parses pasted lines with any of the separators and collapses duplicates', () => {
    const r = parseLeadLines(
      '+79001234567;Олег;Москва;34;beboo\n8 900 1234567, Олег\n# comment\n\n+79005550000\tИра\t\t\nabc;x',
    );
    expect(r.items).toEqual([
      {
        phone_e164: '+79001234567',
        username: null,
        channel: 'telegram',
        first_name: 'Олег',
        city: 'Москва',
        age: 34,
        site: 'beboo',
      },
      {
        phone_e164: '+79005550000',
        username: null,
        channel: 'telegram',
        first_name: 'Ира',
        city: null,
        age: null,
        site: null,
      },
    ]);
    expect(r.errors).toEqual([
      'строка 6: не похоже на телефон или @username — «abc»',
    ]);
    expect(r.duplicates).toBe(1);
  });

  it('usernames: @, bare, t.me links; case-folded; digits stay phones', () => {
    expect(normalizeUsername('@Durov')).toBe('durov');
    expect(normalizeUsername('https://t.me/Durov/')).toBe('durov');
    expect(normalizeUsername('t.me/some_name_42')).toBe('some_name_42');
    expect(normalizeUsername('ab')).toBeNull();
    expect(normalizeUsername('1234567')).toBeNull();
    expect(parseLeadContact('+7 900 123-45-67')).toEqual({
      phone_e164: '+79001234567',
      username: null,
      channel: 'telegram',
    });
    expect(parseLeadContact('@Durov')).toEqual({
      username: 'durov',
      phone_e164: null,
      channel: 'telegram',
    });
    expect(parseLeadContact('durov')).toEqual({
      username: 'durov',
      phone_e164: null,
      channel: 'telegram',
    });
    expect(parseLeadContact('???')).toBeNull();
    const r = parseLeadLines('@Durov;Павел\nt.me/durov\n+79001234567');
    expect(r.items.map((i) => i.username ?? i.phone_e164)).toEqual([
      'durov',
      '+79001234567',
    ]);
    expect(r.duplicates).toBe(1);
  });

  it('recognises flood signals and nothing else', () => {
    expect(floodRetryAfter({ errorMessage: 'FLOOD_WAIT', seconds: 300 })).toBe(
      300,
    );
    expect(floodRetryAfter({ errorMessage: 'FLOOD_WAIT', seconds: 5 })).toBe(
      60,
    );
    expect(floodRetryAfter({ message: 'RPCError: 420: FLOOD_WAIT_120' })).toBe(
      120,
    );
    expect(floodRetryAfter({ errorMessage: 'PEER_FLOOD' })).toBe(6 * 3600);
    expect(floodRetryAfter(new Error('ECONNRESET'))).toBeNull();
  });

  it('moscow day and hours', () => {
    const ts = Date.UTC(2026, 8, 7, 21, 30) / 1000;
    expect(mskDayStart(ts)).toBe(Date.UTC(2026, 8, 7, 21, 0) / 1000);
    expect(withinOutreachHours(ts, [10, 21])).toBe(false);
    expect(
      withinOutreachHours(Date.UTC(2026, 8, 8, 9, 0) / 1000, [10, 21]),
    ).toBe(true);
  });
});
