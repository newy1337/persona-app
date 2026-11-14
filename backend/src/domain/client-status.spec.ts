import { inactiveOverWeek } from './client-status';

describe('inactiveOverWeek', () => {
  const now = 10_000_000;
  const day = 86400;

  it('давно и в этом месяце — дольше недели', () => {
    expect(inactiveOverWeek({ kind: 'hidden', at: null }, now)).toBe(true);
    expect(inactiveOverWeek({ kind: 'last_month', at: null }, now)).toBe(true);
  });

  it('был в сети больше недели назад — неактивен', () => {
    expect(inactiveOverWeek({ kind: 'offline', at: now - 8 * day }, now)).toBe(
      true,
    );
    expect(inactiveOverWeek({ kind: 'offline', at: now - 6 * day }, now)).toBe(
      false,
    );
  });

  it('в сети, недавно, на этой неделе или статуса нет — активен', () => {
    expect(inactiveOverWeek({ kind: 'online', at: now + 60 }, now)).toBe(false);
    expect(inactiveOverWeek({ kind: 'recently', at: null }, now)).toBe(false);
    expect(inactiveOverWeek({ kind: 'last_week', at: null }, now)).toBe(false);
    expect(inactiveOverWeek(null, now)).toBe(false);
    expect(inactiveOverWeek({ kind: 'offline', at: null }, now)).toBe(false);
  });
});
