import { DEFAULT_TYPING, type TypingStyle } from 'src/domain/typing';

/**
 * Ритм личности: когда она пишет сама и как быстро отвечает.
 *
 * Документ лежит в секции `rhythm` личности и правится в панели. Здесь —
 * форма, умолчания и проверка. Всё незаполненное или кривое берётся из
 * умолчаний: сломанное поле не должно превращать задержку в ноль или в сутки.
 *
 * Время окон — «часы на стене» в `timezone`, минуты задержек — реальные.
 */

export interface TimeWindow {
  enabled: boolean;
  /** "07:00" — начало окна. */
  from: string;
  /** "11:00" — конец окна; "00:00" значит полночь, конец суток. */
  to: string;
}

export interface Rhythm {
  /** Часовой пояс окон, IANA: "Europe/Moscow". */
  timezone: string;
  timezone_mode?: 'manual' | 'bio';
  reply_delay: {
    enabled: boolean;
    /** Сколько минут от первого сообщения собеседника она отвечает быстро. */
    warmup_minutes: number;
    warmup_min_minutes: number;
    warmup_max_minutes: number;
    /** Обычная задержка после разогрева. */
    min_minutes: number;
    max_minutes: number;
    /**
     * Поток сообщений: ответ ждёт, пока он замолчит на столько секунд, и уходит
     * одним на всё сразу. Ноль — отвечать в срок, не дожидаясь паузы.
     */
    burst_seconds: number;
  };
  after_silence: {
    enabled: boolean;
    /** Собеседник не отвечал на её сообщение дольше этого — отвечает с долгой задержкой. */
    silence_hours: number;
    min_hours: number;
    max_hours: number;
  };
  /** Утреннее сообщение: одно в день, в случайный момент окна. */
  morning: TimeWindow;
  /** Окно возможного прощания: только при поводе из разговора, не обязательная отправка. */
  goodnight: TimeWindow;
  /** Не писать утро и прощание тем, кто молчит дольше этого. */
  skip_if_silent_days: number;
  /**
   * Сколько сообщений без повода (утро, прощание, «куда пропал») она пишет подряд,
   * пока он не ответит. 0 — сама не пишет, пока он молчит.
   */
  max_unanswered: number;
  /**
   * Старые сообщения: пришли, пока аккаунт был не в сети, или остались без ответа.
   * Ответ на них — не как на свежее: позже, не ночью и с оглядкой на паузу.
   */
  /** «Печатает…» перед каждой частью ответа: скорость набора и паузы (как в persona-chat). */
  typing: TypingStyle;
  late_messages: {
    /** Отвечать ли на старые вообще. */
    enabled: boolean;
    /** Старше скольких часов сообщение считается старым. */
    stale_after_hours: number;
    /** Старше скольких дней — не отвечать совсем. */
    max_age_days: number;
  };
}

export const DEFAULT_RHYTHM: Rhythm = {
  timezone: 'Europe/Moscow',
  reply_delay: {
    enabled: true,
    warmup_minutes: 90,
    warmup_min_minutes: 1,
    warmup_max_minutes: 2,
    min_minutes: 3,
    max_minutes: 20,
    burst_seconds: 30,
  },
  after_silence: {
    enabled: true,
    silence_hours: 2,
    min_hours: 1,
    max_hours: 3,
  },
  morning: { enabled: true, from: '07:00', to: '11:00' },
  goodnight: { enabled: true, from: '21:00', to: '00:00' },
  skip_if_silent_days: 2,
  max_unanswered: 1,
  late_messages: { enabled: true, stale_after_hours: 12, max_age_days: 7 },
  typing: DEFAULT_TYPING,
};

const CLOCK_RX = /^([01]?\d|2[0-3]):([0-5]\d)$/;

/** "07:30" → 450; кривое — null. */
export function clockMinutes(value: unknown): number | null {
  const m = CLOCK_RX.exec(String(value ?? '').trim());
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

export function isTimezone(value: unknown): boolean {
  if (typeof value !== 'string' || !value.trim()) return false;
  try {
    new Intl.DateTimeFormat('en-GB', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

const num = (
  value: unknown,
  fallback: number,
  lo: number,
  hi: number,
): number => {
  const n =
    typeof value === 'number'
      ? value
      : typeof value === 'string' && value.trim()
        ? Number(value)
        : NaN;
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : fallback;
};
const bool = (value: unknown, fallback: boolean): boolean =>
  typeof value === 'boolean' ? value : fallback;
const obj = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

function window(value: unknown, fallback: TimeWindow): TimeWindow {
  const w = obj(value);
  return {
    enabled: bool(w.enabled, fallback.enabled),
    from: clockMinutes(w.from) !== null ? String(w.from).trim() : fallback.from,
    to: clockMinutes(w.to) !== null ? String(w.to).trim() : fallback.to,
  };
}

/** min > max — меняем местами: оператор ввёл диапазон задом наперёд, а не хотел ноль. */
function range(lo: number, hi: number): [number, number] {
  return lo <= hi ? [lo, hi] : [hi, lo];
}

/** Документ личности поверх умолчаний; вызывается на каждое чтение, дёшево. */
export function mergeRhythm(doc: unknown): Rhythm {
  const d = obj(doc);
  const rd = obj(d.reply_delay);
  const as = obj(d.after_silence);
  const D = DEFAULT_RHYTHM;

  const [wMin, wMax] = range(
    num(rd.warmup_min_minutes, D.reply_delay.warmup_min_minutes, 0, 1440),
    num(rd.warmup_max_minutes, D.reply_delay.warmup_max_minutes, 0, 1440),
  );
  const [nMin, nMax] = range(
    num(rd.min_minutes, D.reply_delay.min_minutes, 0, 1440),
    num(rd.max_minutes, D.reply_delay.max_minutes, 0, 1440),
  );
  const [sMin, sMax] = range(
    num(as.min_hours, D.after_silence.min_hours, 0, 48),
    num(as.max_hours, D.after_silence.max_hours, 0, 48),
  );
  return {
    timezone: isTimezone(d.timezone) ? String(d.timezone) : D.timezone,
    ...(d.timezone_mode === 'bio' ? { timezone_mode: 'bio' as const } : {}),
    reply_delay: {
      enabled: bool(rd.enabled, D.reply_delay.enabled),
      warmup_minutes: num(
        rd.warmup_minutes,
        D.reply_delay.warmup_minutes,
        0,
        24 * 60,
      ),
      warmup_min_minutes: wMin,
      warmup_max_minutes: wMax,
      min_minutes: nMin,
      max_minutes: nMax,
      burst_seconds: num(rd.burst_seconds, D.reply_delay.burst_seconds, 0, 600),
    },
    after_silence: {
      enabled: bool(as.enabled, D.after_silence.enabled),
      silence_hours: num(
        as.silence_hours,
        D.after_silence.silence_hours,
        0,
        72,
      ),
      min_hours: sMin,
      max_hours: sMax,
    },
    morning: window(d.morning, D.morning),
    goodnight: window(d.goodnight, D.goodnight),
    skip_if_silent_days: num(
      d.skip_if_silent_days,
      D.skip_if_silent_days,
      0,
      60,
    ),
    max_unanswered: num(d.max_unanswered, D.max_unanswered, 0, 5),
    typing: (() => {
      const t = obj(d.typing);
      const [pMin, pMax] = range(
        num(t.part_pause_min, D.typing.part_pause_min, 0, 60),
        num(t.part_pause_max, D.typing.part_pause_max, 0, 60),
      );
      return {
        enabled: bool(t.enabled, D.typing.enabled),
        chars_per_second: num(
          t.chars_per_second,
          D.typing.chars_per_second,
          1,
          100,
        ),
        min_seconds: num(t.min_seconds, D.typing.min_seconds, 0, 60),
        part_pause_min: pMin,
        part_pause_max: pMax,
      };
    })(),
    late_messages: {
      enabled: bool(obj(d.late_messages).enabled, D.late_messages.enabled),
      stale_after_hours: num(
        obj(d.late_messages).stale_after_hours,
        D.late_messages.stale_after_hours,
        1,
        24 * 14,
      ),
      max_age_days: num(
        obj(d.late_messages).max_age_days,
        D.late_messages.max_age_days,
        1,
        365,
      ),
    },
  };
}

/**
 * Проверка документа перед сохранением: список ошибок человеческим языком.
 * Движок кривое и так заменит умолчанием, но оператор должен узнать об опечатке
 * сразу, а не через неделю, когда бот ответит мгновенно.
 */
export function rhythmErrors(doc: unknown): string[] {
  const errors: string[] = [];
  const d = obj(doc);
  const checkNum = (value: unknown, label: string, lo: number, hi: number) => {
    if (value === undefined) return;
    if (
      typeof value !== 'number' ||
      !Number.isFinite(value) ||
      value < lo ||
      value > hi
    ) {
      errors.push(`${label}: число от ${lo} до ${hi}`);
    }
  };
  const checkBool = (value: unknown, label: string) => {
    if (value !== undefined && typeof value !== 'boolean')
      errors.push(`${label}: да или нет`);
  };
  const checkRange = (lo: unknown, hi: unknown, label: string) => {
    if (typeof lo === 'number' && typeof hi === 'number' && lo > hi)
      errors.push(`${label}: «от» больше «до»`);
  };

  if (d.timezone !== undefined && !isTimezone(d.timezone))
    errors.push(`часовой пояс «${String(d.timezone)}» не найден`);

  const rd = obj(d.reply_delay);
  checkBool(rd.enabled, 'задержка ответа');
  checkNum(rd.warmup_minutes, 'разогрев, минут', 0, 24 * 60);
  checkNum(rd.warmup_min_minutes, 'задержка в разогреве, от', 0, 1440);
  checkNum(rd.warmup_max_minutes, 'задержка в разогреве, до', 0, 1440);
  checkNum(rd.min_minutes, 'обычная задержка, от', 0, 1440);
  checkNum(rd.max_minutes, 'обычная задержка, до', 0, 1440);
  checkRange(
    rd.warmup_min_minutes,
    rd.warmup_max_minutes,
    'задержка в разогреве',
  );
  checkRange(rd.min_minutes, rd.max_minutes, 'обычная задержка');
  checkNum(rd.burst_seconds, 'пауза в потоке, секунд', 0, 600);

  const as = obj(d.after_silence);
  checkBool(as.enabled, 'после молчания');
  checkNum(as.silence_hours, 'молчание дольше, часов', 0, 72);
  checkNum(as.min_hours, 'задержка после молчания, от', 0, 48);
  checkNum(as.max_hours, 'задержка после молчания, до', 0, 48);
  checkRange(as.min_hours, as.max_hours, 'задержка после молчания');

  for (const [key, label] of [
    ['morning', 'утро'],
    ['goodnight', 'прощание'],
  ] as const) {
    const w = obj(d[key]);
    checkBool(w.enabled, label);
    for (const edge of ['from', 'to'] as const) {
      if (w[edge] !== undefined && clockMinutes(w[edge]) === null) {
        errors.push(
          `${label}, ${edge === 'from' ? 'с' : 'до'}: время в виде ЧЧ:ММ`,
        );
      }
    }
  }
  checkNum(d.skip_if_silent_days, 'не писать молчащим дольше, дней', 0, 60);
  const ty = obj(d.typing);
  checkBool(ty.enabled, '«печатает…»');
  checkNum(ty.chars_per_second, 'скорость набора, знаков в секунду', 1, 100);
  checkNum(ty.min_seconds, 'набор не короче, секунд', 0, 60);
  checkNum(ty.part_pause_min, 'пауза между частями, от', 0, 60);
  checkNum(ty.part_pause_max, 'пауза между частями, до', 0, 60);
  checkRange(ty.part_pause_min, ty.part_pause_max, 'пауза между частями');
  const lm = obj(d.late_messages);
  checkBool(lm.enabled, 'отвечать на старые сообщения');
  checkNum(
    lm.stale_after_hours,
    'старое сообщение — старше, часов',
    1,
    24 * 14,
  );
  checkNum(lm.max_age_days, 'не отвечать на сообщения старше, дней', 1, 365);
  return errors;
}
