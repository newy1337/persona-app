import { expect, test } from 'vitest';
import { moscowDay, moscowInputTimestamp } from './panelTime';
import { whenLabel } from './telegramStatus';
test('Moscow dates, input and presence do not follow the browser timezone', () => {
  const midnight = Date.parse('2026-09-30T00:30:00+03:00');
  expect(moscowDay(new Date(midnight))).toBe('2026-09-30');
  expect(moscowInputTimestamp('2026-09-30T00:30')).toBe(midnight / 1000);
  expect(whenLabel(midnight / 1000, midnight / 1000 + 3600)).toBe('сегодня в 00:30');
  expect(() => moscowInputTimestamp('not a date')).toThrow('МСК');
});
