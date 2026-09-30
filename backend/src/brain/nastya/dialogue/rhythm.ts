import { capital, voiceOf, type Gender } from '../character/gender';
import { clockMinutes, type Rhythm, type TimeWindow } from '../config/rhythm';

/**
 * Расчёты ритма без побочных эффектов: задержка ответа, окна утра и прощания.
 *
 * Всё время — unix-секунды, стенные часы — в поясе ритма. Случайность приходит
 * параметром, чтобы тесты могли её прибить.
 */

const DAY_MINUTES = 24 * 60;

/**
 * Пояса живут вечно, а `Intl.DateTimeFormat` строится долго. Прогноз перебирает
 * двое суток с шагом десять минут для каждого чата, поэтому на список диалогов
 * приходились сотни тысяч таких объектов: треть процессорного времени сервера
 * уходила сюда, и панель отвечала секундами.
 */
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

/** Одни и те же минуты запрашиваются по многу раз подряд — считаем их однажды. */
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

/** Минуты от полуночи по стенным часам пояса. */
export function zonedMinutes(at: Date, timeZone: string): number {
  return zonedParts(at, timeZone).minutes;
}

/** Календарный день YYYY-MM-DD по стенным часам пояса. */
export function zonedDate(at: Date, timeZone: string): string {
  return zonedParts(at, timeZone).date;
}

/** Окно в минутах: начало и длина. «До» раньше «с» — окно через полночь; "00:00" — конец суток. */
export function windowSpan(w: Pick<TimeWindow, 'from' | 'to'>): {
  start: number;
  length: number;
} {
  const start = clockMinutes(w.from) ?? 0;
  const end = clockMinutes(w.to) ?? 0;
  const length = end > start ? end - start : DAY_MINUTES - start + end;
  return { start, length };
}

/** Сколько минут прошло от начала окна; вне окна — null. */
export function minutesIntoWindow(
  nowMinutes: number,
  w: Pick<TimeWindow, 'from' | 'to'>,
): number | null {
  const { start, length } = windowSpan(w);
  const into = (nowMinutes - start + DAY_MINUTES) % DAY_MINUTES;
  return into < length ? into : null;
}

/** Детерминированное «случайное» число: одно на чат, день и вид — рестарт его не перебросит. */
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
  /** Пора писать: окно открыто и назначенная минута наступила. */
  due: boolean;
  /** День окна (для окна через полночь — день его начала): ключ «уже писала». */
  day: string;
  /** Начало окна, unix-секунды; null вне окна. */
  windowStartTs: number | null;
  /** На какой минуте окна назначено сообщение. */
  plannedMinute: number;
}

/**
 * Утро или прощание для одного чата сейчас.
 *
 * Минута внутри окна выбирается хешем чата и дня: у разных собеседников
 * «доброе утро» приходит в разное время, а у одного — не скачет от рестарта.
 */
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

/**
 * Сколько секунд из промежутка человек не спал.
 *
 * Молчание ночью — не игнор: ночь в ритме — от конца прощания до начала утра.
 * Считается шагами по 5 минут; длинные промежутки режутся двумя неделями.
 */
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
  /** Когда пришло сообщение, на которое отвечаем. */
  inboundTs: number;
  /** Первое сообщение собеседника в этом чате (или это же). */
  firstUserTs: number | null;
  /** Её последнее сообщение до входящего. */
  lastAssistantTs: number | null;
  /** Его предыдущее сообщение до входящего. */
  prevUserTs: number | null;
  /**
   * Когда в последний раз прощались на ночь (она или он). Разговор, закрытый
   * «спокойной ночи», утром не игнор — долгой задержки за ночь не полагается.
   */
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

/**
 * Через сколько ответить на входящее.
 *
 *  1. Разогрев: первые `warmup_minutes` от его первого сообщения — быстро.
 *     Стоит первым: ответ на холодное сообщение лиду не должен ждать часами,
 *     даже если сам лид молчал до этого сутки.
 *  2. После молчания: она написала, он не отвечал дольше `silence_hours`
 *     бодрствования — отвечает не сразу. Следующий ответ уже обычный.
 *  3. Обычная задержка.
 */
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

/**
 * К какому дню отнести прощание. «Спокойной ночи» в половине второго ночи —
 * это прощание вчерашнего вечера, а не сегодняшнего: иначе вечером она не попрощается.
 */
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

/** Он прощается на ночь — тогда её собственное прощание сегодня не нужно. */
export function isGoodnightText(text: string): boolean {
  return GOODNIGHT_RX.test(text ?? '');
}

export type Staleness = 'fresh' | 'late' | 'expired';

/**
 * Насколько старое входящее. «Догон пропущенных» при подключении аккаунта приносит
 * сообщения и недельной давности — отвечать на них как на свежие нельзя.
 */
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

/**
 * Срок, выпавший на ночь, переносится на утро: от начала утреннего окна плюс
 * случайные (но постоянные для чата) полчаса — чтобы старые ответы не ушли пачкой в 7:00.
 */
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

/** «5 дней», «14 часов» — для подсказки модели, сколько сообщение ждало ответа. */
export function ageText(seconds: number): string {
  const hours = Math.round(seconds / 3600);
  if (hours < 48) return `${Math.max(1, hours)} ч`;
  return `${Math.round(hours / 24)} дн`;
}

/** Подсказка для судьи и автора: сообщение старое, отвечать как вернувшийся к переписке человек. */
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
