import {
  floodRetryAfter,
  mskDayStart,
  normalizePhone,
  normalizeUsername,
  parseLeadContact,
  parseLeadLines,
  withinOutreachHours,
} from './leads';

describe('leads domain', () => {
  it('normalises phones to E.164', () => {
    expect(normalizePhone('+7 (900) 123-45-67')).toBe('+79001234567');
    expect(normalizePhone('8 900 1234567')).toBe('+79001234567');
    expect(normalizePhone('79001234567')).toBe('+79001234567');
    expect(normalizePhone('12025550123')).toBe('+12025550123');
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
        first_name: 'Олег',
        city: 'Москва',
        age: 34,
        site: 'beboo',
      },
      {
        phone_e164: '+79005550000',
        username: null,
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
    });
    expect(parseLeadContact('@Durov')).toEqual({
      username: 'durov',
      phone_e164: null,
    });
    expect(parseLeadContact('durov')).toEqual({
      username: 'durov',
      phone_e164: null,
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
