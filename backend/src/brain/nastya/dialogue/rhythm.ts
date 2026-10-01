import { capital, voiceOf, type Gender } from '../character/gender';
import { clockMinutes, type Rhythm, type TimeWindow } from '../config/rhythm';

const DAY_MINUTES = 24 * 60;

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let formatter = formatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    });
    formatters.set(timeZone, formatter);
  }
  return formatter;
}

const parsed = new Map<string, { date: string; minutes: number }>();
const PARSED_CAP = 4096;

const zonedParts = (at: Date, timeZone: string) => {
  const key = `${timeZone}|${Math.floor(at.getTime() / 60000)}`;
  const hit = parsed.get(key);
  if (hit) return hit;
  const parts = formatterFor(timeZone).formatToParts(at);
  const get = (type: string) =>
    parts.find((p) => p.type === type)?.value ?? '00';
  const value = {
    date: `${get('year')}-${get('month')}-${get('day')}`,
    minutes: Number(get('hour')) * 60 + Number(get('minute')),
  };
  if (parsed.size >= PARSED_CAP) parsed.clear();
  parsed.set(key, value);
  return value;
};

export function zonedMinutes(at: Date, timeZone: string): number {
  return zonedParts(at, timeZone).minutes;
}

export function zonedDate(at: Date, timeZone: string): string {
  return zonedParts(at, timeZone).date;
}

export function windowSpan(w: Pick<TimeWindow, 'from' | 'to'>): {
  start: number;
  length: number;
} {
  const start = clockMinutes(w.from) ?? 0;
  const end = clockMinutes(w.to) ?? 0;
  const length = end > start ? end - start : DAY_MINUTES - start + end;
  return { start, length };
}

export function minutesIntoWindow(
  nowMinutes: number,
  w: Pick<TimeWindow, 'from' | 'to'>,
): number | null {
  const { start, length } = windowSpan(w);
  const into = (nowMinutes - start + DAY_MINUTES) % DAY_MINUTES;
  return into < length ? into : null;
}

export function stableHash(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export type RitualKind = 'morning' | 'goodnight';

export interface RitualSlot {
  due: boolean;
  day: string;
  windowStartTs: number | null;
  plannedMinute: number;
}

export function ritualSlot(
  now: Date,
  w: TimeWindow,
  timeZone: string,
  chatId: number,
  kind: RitualKind,
): RitualSlot {
  const { length } = windowSpan(w);
  const minutes = zonedMinutes(now, timeZone);
  const into = minutesIntoWindow(minutes, w);
  const nowTs = Math.floor(now.getTime() / 1000);
  const startedYesterday =
    into !== null && minutes < (clockMinutes(w.from) ?? 0);
  const day = zonedDate(
    new Date((nowTs - (startedYesterday ? DAY_MINUTES * 60 : 0)) * 1000),
    timeZone,
  );
  const plannedMinute =
    length > 0 ? stableHash(`${chatId}:${day}:${kind}`) % length : 0;
  return {
    due: w.enabled && into !== null && into >= plannedMinute,
    day,
    windowStartTs:
      into === null ? null : nowTs - into * 60 - (now.getUTCSeconds() % 60),
    plannedMinute,
  };
}

export function awakeSeconds(
  fromTs: number,
  toTs: number,
  rhythm: Pick<Rhythm, 'timezone' | 'morning' | 'goodnight'>,
): number {
  if (toTs <= fromTs) return 0;
  const night = { from: rhythm.goodnight.to, to: rhythm.morning.from };
  const hasNight = clockMinutes(night.from) !== clockMinutes(night.to);
  const step = 300;
  const end = Math.min(toTs, fromTs + 14 * 86400);
  let awake = 0;
  for (let t = fromTs; t < end; t += step) {
    const span = Math.min(step, end - t);
    if (
      !hasNight ||
      minutesIntoWindow(
        zonedMinutes(new Date(t * 1000), rhythm.timezone),
        night,
      ) === null
    )
      awake += span;
  }
  return awake;
}

export interface DelayInput {
  inboundTs: number;
  firstUserTs: number | null;
  lastAssistantTs: number | null;
  prevUserTs: number | null;
  lastGoodnightTs?: number | null;
}

export type DelayReason =
  'off' | 'warmup' | 'after_silence' | 'normal' | 'late';

export interface ReplyDelay {
  seconds: number;
  reason: DelayReason;
}

const between = (lo: number, hi: number, random: () => number) =>
  lo + (hi - lo) * random();

export function replyDelay(
  input: DelayInput,
  rhythm: Rhythm,
  random: () => number = Math.random,
): ReplyDelay {
  const rd = rhythm.reply_delay;
  const first = input.firstUserTs ?? input.inboundTs;
  const inWarmup = input.inboundTs - first < rd.warmup_minutes * 60;

  if (rd.enabled && inWarmup) {
    return {
      seconds: Math.round(
        between(rd.warmup_min_minutes, rd.warmup_max_minutes, random) * 60,
      ),
      reason: 'warmup',
    };
  }

  const as = rhythm.after_silence;
  const sheWroteLast =
    input.lastAssistantTs !== null &&
    (input.prevUserTs === null || input.lastAssistantTs >= input.prevUserTs);
  const lastLine = Math.max(input.lastAssistantTs ?? 0, input.prevUserTs ?? 0);
  const closedForNight =
    input.lastGoodnightTs != null && input.lastGoodnightTs >= lastLine - 3600;
  if (
    as.enabled &&
    sheWroteLast &&
    !closedForNight &&
    awakeSeconds(input.lastAssistantTs!, input.inboundTs, rhythm) >=
      as.silence_hours * 3600
  ) {
    return {
      seconds: Math.round(between(as.min_hours, as.max_hours, random) * 3600),
      reason: 'after_silence',
    };
  }

  if (!rd.enabled) return { seconds: 0, reason: 'off' };
  return {
    seconds: Math.round(between(rd.min_minutes, rd.max_minutes, random) * 60),
    reason: 'normal',
  };
}

const WORD_START = '(?<![а-яёa-z])';
const WORD_END = '(?![а-яёa-z])';
const GOODNIGHT_RX = new RegExp(
  [
    '(спокойной|доброй|хорошей)\\s+ночи',
    'сладких\\s+снов',
    `${WORD_START}спокойной${WORD_END}(?!\\s+(дня|недели|работы|смены|жизни|обстановк))`,
    `${WORD_START}(спок[иа]?|спокойки|ночки)${WORD_END}`,
    '(иду|пошёл|пошел|пойду|ложусь|пора)\\s+спать',
    `${WORD_START}до\\s+завтра${WORD_END}`,
  ].join('|'),
  'iu',
);

export function goodnightDay(
  now: Date,
  rhythm: Pick<Rhythm, 'timezone' | 'morning' | 'goodnight'>,
): string {
  const slot = ritualSlot(
    now,
    rhythm.goodnight,
    rhythm.timezone,
    0,
    'goodnight',
  );
  if (slot.windowStartTs !== null) return slot.day;
  const beforeMorning =
    zonedMinutes(now, rhythm.timezone) <
    (clockMinutes(rhythm.morning.from) ?? 0);
  return zonedDate(
    beforeMorning ? new Date(now.getTime() - DAY_MINUTES * 60_000) : now,
    rhythm.timezone,
  );
}

export function isGoodnightText(text: string): boolean {
  return GOODNIGHT_RX.test(text ?? '');
}

export type Staleness = 'fresh' | 'late' | 'expired';

export function staleness(
  inboundTs: number,
  nowTs: number,
  rhythm: Pick<Rhythm, 'late_messages'>,
): Staleness {
  const age = nowTs - inboundTs;
  if (age > rhythm.late_messages.max_age_days * 86400) return 'expired';
  if (age > rhythm.late_messages.stale_after_hours * 3600) return 'late';
  return 'fresh';
}

export function outOfNight(
  ts: number,
  rhythm: Pick<Rhythm, 'timezone' | 'morning' | 'goodnight'>,
  seed = 0,
): number {
  const night = { from: rhythm.goodnight.to, to: rhythm.morning.from };
  if (clockMinutes(night.from) === clockMinutes(night.to)) return ts;
  const into = minutesIntoWindow(
    zonedMinutes(new Date(ts * 1000), rhythm.timezone),
    night,
  );
  if (into === null) return ts;
  const { length } = windowSpan(night);
  const morningAt = ts + (length - into) * 60 - (ts % 60);
  return morningAt + (stableHash(`${seed}:${morningAt}`) % 30) * 60;
}

export function ageText(seconds: number): string {
  const hours = Math.round(seconds / 3600);
  if (hours < 48) return `${Math.max(1, hours)} ч`;
  return `${Math.round(hours / 24)} дн`;
}

export function lateReplyNote(
  ageSeconds: number,
  gender: Gender = 'female',
): string {
  const g = voiceOf(gender);
  return (
    `${capital(g.they.him)} последние сообщения пришли ${ageText(ageSeconds)} назад, и ты тогда не ${g.v('ответила', 'ответил')}. ` +
    'Не отвечай так, будто они пришли только что, и не делай вид, что паузы не было: коротко и по-человечески ' +
    `извинись, что ${g.v('пропала', 'пропал')}, и мягко продолжи разговор — без оправданий на полэкрана и без выдуманных причин. ` +
    `Всё, что ${g.they.he} ${g.c('писал', 'писала')} про «сегодня», «сейчас» или «вечером», относится к тому дню — он давно прошёл: ` +
    `не подхватывай это как сегодняшнее, лучше спроси, как у ${g.they.him === 'его' ? 'него' : 'неё'} дела теперь.`
  );
}
