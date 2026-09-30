import { DEFAULT_RHYTHM, mergeRhythm, rhythmErrors } from '../config/rhythm';
import {
  ageText,
  awakeSeconds,
  goodnightDay,
  isGoodnightText,
  lateReplyNote,
  outOfNight,
  staleness,
  minutesIntoWindow,
  replyDelay,
  ritualSlot,
  windowSpan,
  zonedMinutes,
} from './rhythm';

const R = DEFAULT_RHYTHM;
const MSK_10 = Date.UTC(2026, 8, 12, 7, 0) / 1000;
const H = 3600;
const M = 60;
const low = () => 0;
const high = () => 1;

describe('задержка ответа', () => {
  it('первые полтора часа от его первого сообщения — 1–2 минуты', () => {
    const input = {
      inboundTs: MSK_10 + 30 * M,
      firstUserTs: MSK_10,
      lastAssistantTs: MSK_10 + 2 * M,
      prevUserTs: MSK_10,
    };
    expect(replyDelay(input, R, low)).toEqual({
      seconds: 60,
      reason: 'warmup',
    });
    expect(replyDelay(input, R, high)).toEqual({
      seconds: 120,
      reason: 'warmup',
    });
  });

  it('первое его сообщение само начинает разогрев', () => {
    expect(
      replyDelay(
        {
          inboundTs: MSK_10,
          firstUserTs: null,
          lastAssistantTs: null,
          prevUserTs: null,
        },
        R,
        low,
      ).reason,
    ).toBe('warmup');
  });

  it('после полутора часов — 3–20 минут', () => {
    const input = {
      inboundTs: MSK_10 + 100 * M,
      firstUserTs: MSK_10,
      lastAssistantTs: MSK_10 + 95 * M,
      prevUserTs: MSK_10 + 94 * M,
    };
    expect(replyDelay(input, R, low)).toEqual({
      seconds: 180,
      reason: 'normal',
    });
    expect(replyDelay(input, R, high)).toEqual({
      seconds: 1200,
      reason: 'normal',
    });
  });

  it('он не отвечал больше двух часов — 1–3 часа', () => {
    const input = {
      inboundTs: MSK_10 + 5 * H,
      firstUserTs: MSK_10 - 24 * H,
      lastAssistantTs: MSK_10 + 2 * H,
      prevUserTs: MSK_10 + H,
    };
    expect(replyDelay(input, R, low)).toEqual({
      seconds: 3600,
      reason: 'after_silence',
    });
    expect(replyDelay(input, R, high)).toEqual({
      seconds: 10800,
      reason: 'after_silence',
    });
  });

  it('следующее сообщение после долгой паузы — снова обычная задержка', () => {
    const input = {
      inboundTs: MSK_10 + 5 * H + 2 * M,
      firstUserTs: MSK_10 - 24 * H,
      lastAssistantTs: MSK_10 + 2 * H,
      prevUserTs: MSK_10 + 5 * H,
    };
    expect(replyDelay(input, R, low).reason).toBe('normal');
  });

  it('молчание — это когда ждала она: если последним писал он, долгой задержки нет', () => {
    const input = {
      inboundTs: MSK_10 + 6 * H,
      firstUserTs: MSK_10 - 24 * H,
      lastAssistantTs: MSK_10,
      prevUserTs: MSK_10 + H,
    };
    expect(replyDelay(input, R, low).reason).toBe('normal');
  });

  it('ночь в молчание не считается: написала в 23:00, он ответил в 07:30 — полтора часа бодрствования', () => {
    const late = Date.UTC(2026, 8, 11, 20, 0) / 1000;
    const at0730 = Date.UTC(2026, 8, 12, 4, 30) / 1000;
    const at0830 = Date.UTC(2026, 8, 12, 5, 30) / 1000;
    expect(awakeSeconds(late, at0730, R)).toBe(1.5 * H);
    expect(awakeSeconds(late, at0830, R)).toBe(2.5 * H);
    const input = {
      inboundTs: at0730,
      firstUserTs: late - 48 * H,
      lastAssistantTs: late,
      prevUserTs: late - 5 * M,
    };
    expect(replyDelay(input, R, low).reason).toBe('normal');
    expect(replyDelay({ ...input, inboundTs: at0830 }, R, low).reason).toBe(
      'after_silence',
    );
  });

  it('попрощались на ночь — утром «доброе утро» не игнор, ответ обычный', () => {
    const night = Date.UTC(2026, 8, 11, 20, 0) / 1000;
    const at0930 = Date.UTC(2026, 8, 12, 6, 30) / 1000;
    const input = {
      inboundTs: at0930,
      firstUserTs: night - 48 * H,
      lastAssistantTs: night,
      prevUserTs: night - 2 * M,
      lastGoodnightTs: night,
    };
    expect(replyDelay(input, R, low).reason).toBe('normal');
    expect(
      replyDelay({ ...input, lastGoodnightTs: night - 24 * H }, R, low).reason,
    ).toBe('after_silence');
  });

  it('разогрев важнее молчания: холодный лид ответил на первое сообщение через сутки', () => {
    const opener = MSK_10 - 24 * H;
    const input = {
      inboundTs: MSK_10,
      firstUserTs: null,
      lastAssistantTs: opener,
      prevUserTs: null,
    };
    expect(replyDelay(input, R, low).reason).toBe('warmup');
  });

  it('задержка выключена — ответ сразу, но молчание всё равно выдерживается', () => {
    const off = mergeRhythm({ reply_delay: { enabled: false } });
    expect(
      replyDelay(
        {
          inboundTs: MSK_10,
          firstUserTs: MSK_10 - 24 * H,
          lastAssistantTs: MSK_10 - 23 * H,
          prevUserTs: MSK_10 - 23.5 * H,
        },
        off,
        low,
      ).reason,
    ).toBe('after_silence');
    expect(
      replyDelay(
        {
          inboundTs: MSK_10,
          firstUserTs: MSK_10 - 24 * H,
          lastAssistantTs: MSK_10 - 5 * M,
          prevUserTs: MSK_10 - 6 * M,
        },
        off,
        low,
      ),
    ).toEqual({ seconds: 0, reason: 'off' });
  });
});

describe('окна утра и прощания', () => {
  it('окно через полночь и «до 00:00» — конец суток', () => {
    expect(windowSpan({ from: '21:00', to: '00:00' })).toEqual({
      start: 1260,
      length: 180,
    });
    expect(windowSpan({ from: '22:00', to: '01:00' })).toEqual({
      start: 1320,
      length: 180,
    });
    expect(minutesIntoWindow(30, { from: '22:00', to: '01:00' })).toBe(150);
    expect(minutesIntoWindow(90, { from: '22:00', to: '01:00' })).toBeNull();
  });

  it('утро: вне окна не пора, внутри — с назначенной минуты', () => {
    const at6 = new Date(Date.UTC(2026, 8, 12, 3, 0));
    expect(ritualSlot(at6, R.morning, R.timezone, 111, 'morning').due).toBe(
      false,
    );

    const at1059 = new Date(Date.UTC(2026, 8, 12, 7, 59));
    const slot = ritualSlot(at1059, R.morning, R.timezone, 111, 'morning');
    expect(slot.due).toBe(true);
    expect(slot.day).toBe('2026-09-12');
    expect(slot.plannedMinute).toBeGreaterThanOrEqual(0);
    expect(slot.plannedMinute).toBeLessThan(240);
    expect(zonedMinutes(new Date(slot.windowStartTs! * 1000), R.timezone)).toBe(
      7 * 60,
    );
  });

  it('минута у разных чатов разная, у одного чата в один день — одна и та же', () => {
    const at = new Date(Date.UTC(2026, 8, 12, 5, 0));
    const a = ritualSlot(
      at,
      R.morning,
      R.timezone,
      111,
      'morning',
    ).plannedMinute;
    expect(
      ritualSlot(at, R.morning, R.timezone, 111, 'morning').plannedMinute,
    ).toBe(a);
    const others = new Set(
      [222, 333, 444, 555, 666].map(
        (id) =>
          ritualSlot(at, R.morning, R.timezone, id, 'morning').plannedMinute,
      ),
    );
    expect(others.size).toBeGreaterThan(1);
  });

  it('хвост окна после полуночи — вчерашний день: второго прощания за ночь не будет', () => {
    const w = { enabled: true, from: '22:00', to: '01:00' };
    const at0030 = new Date(Date.UTC(2026, 8, 12, 21, 30));
    expect(ritualSlot(at0030, w, R.timezone, 1, 'goodnight').day).toBe(
      '2026-09-12',
    );
  });

  it('выключенное окно никогда не «пора»', () => {
    const at = new Date(Date.UTC(2026, 8, 12, 7, 59));
    expect(
      ritualSlot(at, { ...R.morning, enabled: false }, R.timezone, 1, 'morning')
        .due,
    ).toBe(false);
  });
});

describe('он прощается', () => {
  it.each([
    'Спокойной ночи',
    'ну всё, сладких снов)',
    'споки',
    'пойду спать',
    'до завтра!',
    'доброй ночи тебе',
  ])('«%s»', (text) => {
    expect(isGoodnightText(text)).toBe(true);
  });
  it.each([
    'спокойно, всё ок',
    'ночью работал',
    'до завтрака ещё далеко',
    'спасибо',
  ])('не прощание: «%s»', (text) => {
    expect(isGoodnightText(text)).toBe(false);
  });
});

describe('день прощания', () => {
  it('вечером — сегодняшний, после полуночи до утра — вчерашний', () => {
    expect(goodnightDay(new Date(Date.UTC(2026, 8, 12, 19, 0)), R)).toBe(
      '2026-09-12',
    );
    expect(goodnightDay(new Date(Date.UTC(2026, 8, 12, 17, 30)), R)).toBe(
      '2026-09-12',
    );
    expect(goodnightDay(new Date(Date.UTC(2026, 8, 12, 22, 30)), R)).toBe(
      '2026-09-12',
    );
    expect(goodnightDay(new Date(Date.UTC(2026, 8, 13, 6, 0)), R)).toBe(
      '2026-09-13',
    );
  });
});

describe('старые сообщения (догон при подключении аккаунта)', () => {
  const now = Date.UTC(2026, 8, 14, 9, 2) / 1000;

  it('свежее, старое и слишком старое', () => {
    expect(staleness(now - 5 * M, now, R)).toBe('fresh');
    expect(staleness(now - 13 * H, now, R)).toBe('late');
    expect(staleness(now - 5 * 24 * H, now, R)).toBe('late');
    expect(staleness(now - 8 * 24 * H, now, R)).toBe('expired');
    expect(
      staleness(
        now - 13 * H,
        now,
        mergeRhythm({ late_messages: { stale_after_hours: 24 } }),
      ),
    ).toBe('fresh');
  });

  it('срок в ночь переносится на утро, днём — не трогается', () => {
    const at0300 = Date.UTC(2026, 8, 14, 0, 0) / 1000;
    const moved = outOfNight(at0300, R, 42);
    const minutes =
      new Date(moved * 1000).getUTCHours() * 60 +
      new Date(moved * 1000).getUTCMinutes() +
      3 * 60;
    expect(minutes).toBeGreaterThanOrEqual(7 * 60);
    expect(minutes).toBeLessThan(7 * 60 + 30);
    const at1400 = Date.UTC(2026, 8, 14, 11, 0) / 1000;
    expect(outOfNight(at1400, R, 42)).toBe(at1400);
  });

  it('модель знает, сколько он ждал, и не делает вид, что сообщение свежее', () => {
    expect(ageText(5 * 24 * H)).toBe('5 дн');
    expect(ageText(14 * H)).toBe('14 ч');
    const note = lateReplyNote(5 * 24 * H);
    expect(note).toMatch(/5 дн назад/);
    expect(note).toMatch(/извинись, что пропала/);
  });
});

describe('документ ритма', () => {
  it('пустой документ — умолчания из описания оператора', () => {
    expect(mergeRhythm({})).toEqual(DEFAULT_RHYTHM);
    expect(DEFAULT_RHYTHM.reply_delay).toMatchObject({
      warmup_minutes: 90,
      warmup_min_minutes: 1,
      warmup_max_minutes: 2,
      min_minutes: 3,
      max_minutes: 20,
    });
    expect(DEFAULT_RHYTHM.after_silence).toMatchObject({
      silence_hours: 2,
      min_hours: 1,
      max_hours: 3,
    });
  });

  it('кривые поля заменяются умолчанием, перевёрнутый диапазон — разворачивается', () => {
    const r = mergeRhythm({
      timezone: 'Mars/Olympus',
      reply_delay: { min_minutes: 20, max_minutes: 3 },
      morning: { from: '7 утра' },
    });
    expect(r.timezone).toBe('Europe/Moscow');
    expect([r.reply_delay.min_minutes, r.reply_delay.max_minutes]).toEqual([
      3, 20,
    ]);
    expect(r.morning.from).toBe('07:00');
  });

  it('проверка перед сохранением называет ошибки словами', () => {
    expect(rhythmErrors(DEFAULT_RHYTHM)).toEqual([]);
    const errors = rhythmErrors({
      timezone: 'Mars/Olympus',
      reply_delay: { min_minutes: 30, max_minutes: 5 },
      after_silence: { min_hours: -1 },
      goodnight: { from: '25:00' },
    });
    expect(errors.join(' | ')).toMatch(/часовой пояс/);
    expect(errors.join(' | ')).toMatch(/обычная задержка: «от» больше «до»/);
    expect(errors.join(' | ')).toMatch(/после молчания, от: число/);
    expect(errors.join(' | ')).toMatch(/прощание, с: время/);
  });
});
