import { cityPlace, unknownPlace } from './location';
import { characterDate } from './clock';
import { turnTime, timeClaimIssues } from './turn-time';
import { insideQuietHours } from '../dialogue/initiative';

const madrid = cityPlace('Мадрид', 'ES');
const kaliningrad = cityPlace('Калининград', 'RU');
const at = new Date('2026-09-21T16:22:42Z');
const same = turnTime(madrid, kaliningrad, at);

describe('local times from city time zones', () => {
  it('reproduces Denis and his interlocutor at the time of the incident', () => {
    expect(same.persona.time).toBe('18:22');
    expect(same.interlocutor.time).toBe('18:22');
    expect(same.persona_ahead_minutes).toBe(0);
  });
  it('recomputes daylight saving offsets, rather than keeping a fixed city offset', () => {
    const winter = turnTime(
      madrid,
      kaliningrad,
      new Date('2026-01-21T16:22:42Z'),
    );
    expect(winter.persona.time).toBe('17:22');
    expect(winter.persona_ahead_minutes).toBe(-60);
  });
  it('keeps different local dates across midnight and uses the persona date', () => {
    const now = new Date('2026-09-21T21:30:00Z');
    const ctx = turnTime(madrid, cityPlace('Пхукет', 'TH'), now);
    expect(ctx.persona.date).toBe('2026-09-21');
    expect(ctx.interlocutor.date).toBe('2026-09-22');
    expect(characterDate(now, madrid.timezone!)).toBe(ctx.persona.date);
  });
  it('supports fractional-hour offsets', () => {
    const ctx = turnTime(cityPlace('Kathmandu', 'NP'), madrid, at);
    expect(ctx.persona.time).toBe('22:07');
    expect(ctx.persona_ahead_minutes).toBe(225);
  });
  it('uses the supplied timezone for quiet hours', () => {
    expect(insideQuietHours(at, '23:00', '08:00', 'Asia/Bangkok')).toBe(true);
    expect(insideQuietHours(at, '23:00', '08:00', 'Europe/Madrid')).toBe(false);
  });
  it('never presents fallback Moscow/Bangkok clocks for an unknown city', () => {
    const ctx = turnTime(madrid, unknownPlace(), at);
    expect(ctx.interlocutor.time).toBeNull();
    expect(ctx.persona_ahead_minutes).toBeNull();
  });
});

describe('time assertions before delivery', () => {
  it('catches the original lunch and fabricated time difference', () => {
    expect(
      timeClaimIssues(
        'у меня как раз только обед начинается, разница во времени немаленькая)',
        same,
      ),
    ).toHaveLength(2);
  });
  it.each(['У меня сейчас утро', 'У меня сейчас 12:00', 'У тебя сейчас ночь'])(
    'rejects %s',
    (text) => {
      expect(timeClaimIssues(text, same).length).toBeGreaterThan(0);
    },
  );
  it.each([
    'У меня сейчас вечер',
    'У меня сейчас 18:22',
    'У нас одинаковое время',
    'Сегодня поздно обедаю',
    'У меня обед будет завтра',
    'У меня день рождения',
  ])('allows %s', (text) => {
    expect(timeClaimIssues(text, same)).toEqual([]);
  });
  it('checks the addressee clock, independently from the persona clock', () => {
    const ctx = turnTime(madrid, cityPlace('Пхукет', 'TH'), at);
    expect(timeClaimIssues('У тебя сейчас ночь', ctx)).toEqual([]);
    expect(timeClaimIssues('У меня сейчас ночь', ctx)).not.toEqual([]);
  });
  it('rejects an unsupported assertion when the addressee city is unknown', () => {
    expect(
      timeClaimIssues(
        'У тебя сейчас утро',
        turnTime(madrid, unknownPlace(), at),
      ),
    ).not.toEqual([]);
  });
});
