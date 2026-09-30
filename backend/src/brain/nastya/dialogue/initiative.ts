import { capital, voiceOf, type Gender } from '../character/gender';
import type { AppSettings, ConversationState } from '../kernel/types';
import { characterClock, characterDate } from '../kernel/clock';
import { asInt, clamp } from '../kernel/coerce';

const MIN_HOURS_SINCE_USER = 3;

/** Её сообщения без повода: написала сама, а не в ответ. */
export const UNPROMPTED_SOURCES: ReadonlySet<string> = new Set([
  'initiative',
  'morning',
  'goodnight',
]);

/**
 * Сколько её сообщений без повода подряд остались без ответа — после его последнего
 * сообщения. Многочастное сообщение в памяти бота — одна запись, считается одним.
 */
export function unansweredUnprompted(state: ConversationState): number {
  const history = state.history ?? [];
  let count = 0;
  for (let i = history.length - 1; i >= 0; i -= 1) {
    const message = history[i];
    if (message.role === 'user') break;
    if (UNPROMPTED_SOURCES.has(String(message.source ?? ''))) count += 1;
  }
  return count;
}

/**
 * Что писать, когда он пропал. Раньше тут был «рассказ о текущем бытовом событии» —
 * и модель выдавала сюжет из биографии (мама, брат, дождь) на 2–3 сообщения.
 * Живой человек в такой момент пишет коротко и спрашивает.
 */
export function checkInGuidance(gender: Gender = 'female'): string {
  const g = voiceOf(gender);
  return (
    `${capital(g.they.he)} давно не отвечает. Напиши ${g.v('сама', 'сам')} ОДНУ короткую живую реплику, как пишут в мессенджере, ` +
    `чтобы просто напомнить о себе и узнать, как ${g.they.he}: например спросить, куда ${g.c('пропал', 'пропала')}, как прошёл день, ` +
    'или вернуться к последней теме разговора вопросом. Своими словами, не копируй примеры ' +
    'и не повторяй свои прошлые такие сообщения из истории. Не рассказывай истории и новости ' +
    'из своей жизни, не упоминай родных, погоду и бытовые события. Без упрёков, обиды и давления. ' +
    'Одна строка, без переносов.'
  );
}

/** Прежнее имя — женская личность. */
export const CHECK_IN_GUIDANCE = checkInGuidance('female');
const MIN_HOURS_BETWEEN_SENDS = 4;

type Clock = readonly [hour: number, minute: number];

function parseClock(value: string, fallback: Clock): Clock {
  const match = /^(\d{1,2}):(\d{1,2})$/.exec((value ?? '').trim());
  if (!match) return fallback;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59)
    return [hour, minute];
  return fallback;
}

function atOrAfter(current: Clock, slot: Clock): boolean {
  return (
    current[0] > slot[0] || (current[0] === slot[0] && current[1] >= slot[1])
  );
}

/** Quiet hours are read in the character's timezone and may wrap midnight. */
export function insideQuietHours(
  now: Date,
  startText: string,
  endText: string,
  timeZone = 'UTC',
): boolean {
  const start = parseClock(startText, [23, 0]);
  const end = parseClock(endText, [8, 0]);
  const current = characterClock(now, timeZone);
  if (start[0] === end[0] && start[1] === end[1]) return true;
  const startsBeforeEnd =
    start[0] < end[0] || (start[0] === end[0] && start[1] < end[1]);
  if (startsBeforeEnd)
    return atOrAfter(current, start) && !atOrAfter(current, end);
  return atOrAfter(current, start) || !atOrAfter(current, end);
}

/**
 * Whether an initiative message is due right now.
 *
 * A message is only sent inside a fixed daily slot, outside quiet hours, when
 * the interlocutor has been silent for a while and enough time has passed
 * since the last one — so silence is never answered with a stream.
 */
export function initiativeIsDue(
  state: ConversationState,
  settings: Pick<
    AppSettings,
    'initiative_enabled' | 'proactive_max_per_day' | 'quiet_start' | 'quiet_end'
  >,
  now: Date,
  timeZone = 'UTC',
): boolean {
  if (!settings.initiative_enabled || !(state.history ?? []).length)
    return false;
  if (insideQuietHours(now, settings.quiet_start, settings.quiet_end, timeZone))
    return false;

  const maxPerDay = clamp(asInt(settings.proactive_max_per_day) || 1, 1, 2);
  const schedule: Clock[] =
    maxPerDay === 1
      ? [[13, 0]]
      : [
          [11, 30],
          [18, 30],
        ];
  const current = characterClock(now, timeZone);
  const dueSlots = schedule.filter((slot) => atOrAfter(current, slot)).length;

  const initiative = state.initiative ?? {};
  const today = characterDate(now, timeZone);
  const sentToday = (initiative.sent_by_date ?? {})[today]?.length ?? 0;
  if (dueSlots <= sentToday) return false;

  const nowTimestamp = Math.floor(now.getTime() / 1000);
  const lastUserAt = (state.history ?? [])
    .filter((message) => message.role === 'user')
    .reduce(
      (latest, message) => Math.max(latest, asInt(message.created_at)),
      0,
    );
  if (lastUserAt && nowTimestamp - lastUserAt < MIN_HOURS_SINCE_USER * 3600)
    return false;

  const lastSentAt = asInt(initiative.last_sent_at);
  return (
    !lastSentAt || nowTimestamp - lastSentAt >= MIN_HOURS_BETWEEN_SENDS * 3600
  );
}
