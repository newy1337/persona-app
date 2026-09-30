import { describe, it, expect } from 'vitest';
import { TIMEZONES, rhythmSummary } from './rhythm';

describe('сводка ритма одной строкой', () => {
  const doc = {
    timezone: 'Europe/Moscow',
    reply_delay: { enabled: true, warmup_minutes: 90, warmup_min_minutes: 1, warmup_max_minutes: 2, min_minutes: 3, max_minutes: 20, burst_seconds: 30 },
    after_silence: { enabled: true, silence_hours: 2, min_hours: 1, max_hours: 3 },
    morning: { enabled: true, from: '07:00', to: '11:00' },
    goodnight: { enabled: true, from: '21:00', to: '00:00' },
    skip_if_silent_days: 2,
  };

  it('цифры оператора читаются как он их сказал', () => {
    expect(rhythmSummary(doc)).toBe(
      'первые 90 мин — 1–2 мин, потом 3–20 мин · после 2 ч молчания — 1–3 ч · утро 07:00–11:00 · прощание 21:00–00:00',
    );
  });

  it('выключенное не упоминается, выключенная задержка — словами', () => {
    const off = { ...doc, reply_delay: { ...doc.reply_delay, enabled: false }, morning: { ...doc.morning, enabled: false } };
    const text = rhythmSummary(off);
    expect(text).toMatch(/^отвечает без задержки/);
    expect(text).not.toMatch(/утро/);
  });

  it('пояс по умолчанию есть в списке выбора', () => {
    expect(TIMEZONES.some((t) => t.id === 'Europe/Moscow')).toBe(true);
    expect(new Set(TIMEZONES.map((t) => t.id)).size).toBe(TIMEZONES.length);
  });
});
