import { describe, expect, it } from 'vitest';
import { accountLostLabel, presenceLabel, whenLabel } from './telegramStatus';

const NOW = Math.floor(new Date('2026-09-16T18:00:00+03:00').getTime() / 1000);
const at = (d, h, m) => Math.floor(new Date(Date.UTC(2026, 8, d, h - 3, m)).getTime() / 1000);

describe('статусы Telegram словами', () => {
  it('был в сети: только что, минуты, сегодня, вчера, дата', () => {
    expect(presenceLabel({ kind: 'online', at: NOW + 60 }, NOW)).toEqual({ tone: 'online', text: 'в сети' });
    expect(presenceLabel({ kind: 'offline', at: NOW - 20 }, NOW).text).toBe('был(а) в сети только что');
    expect(presenceLabel({ kind: 'offline', at: NOW - 600 }, NOW).text).toBe('был(а) в сети 10 мин назад');
    expect(presenceLabel({ kind: 'offline', at: at(16, 15, 20) }, NOW).text).toBe('был(а) в сети сегодня в 15:20');
    expect(presenceLabel({ kind: 'offline', at: at(15, 9, 5) }, NOW, { short: true }).text).toBe('был(а) вчера в 09:05');
    expect(whenLabel(at(12, 23, 59), NOW)).toBe('12 сен в 23:59');
  });

  it('неточные статусы и неизвестный', () => {
    expect(presenceLabel({ kind: 'recently', at: null }, NOW).text).toBe('был(а) в сети недавно');
    expect(presenceLabel({ kind: 'last_week', at: null }, NOW, { short: true }).text).toBe('был(а) на этой неделе');
    expect(presenceLabel({ kind: 'hidden', at: null }, NOW).text).toBe('время в сети скрыто');
    expect(presenceLabel(null, NOW)).toBeNull();
  });

  it('аккаунт: бан и конец сессии', () => {
    expect(accountLostLabel('banned', { short: true })).toBe('бан Telegram');
    expect(accountLostLabel({ kind: 'logged_out' })).toMatch(/войти заново/);
    expect(accountLostLabel(null)).toBeNull();
  });
});
