import { isGoodnightText } from './rhythm';
import { voiceOf, type Gender } from '../character/gender';

const WORD_START = '(?<![а-яёa-z])';
const WORD_END = '(?![а-яёa-z])';

const MORNING_RX = new RegExp(
  [
    '(доброе|доброго|доброго\\s+тебе)\\s+утр',
    'с\\s+добрым\\s+утр',
    'утро\\s+доброе',
    `${WORD_START}утречк`,
    `${WORD_START}(морнинг|гуд\\s*морнинг)${WORD_END}`,
  ].join('|'),
  'iu',
);

const GOODNIGHT_FRAGMENT =
  /(спокойной|доброй|хорошей)\s+ночи|(?<![а-яёa-z])спокойной(?![а-яёa-z])(?!\s+(дня|недели|работы|смены|жизни|обстановк))|сладких\s+снов|(?<![а-яёa-z])(спок[иа]?|спокойки|ночки)(?![а-яёa-z])|(?<![а-яёa-z])до\s+завтра(?![а-яёa-z])/iu;

export const isMorningText = (text: string): boolean =>
  MORNING_RX.test(text ?? '');

const CLOSING_RX = new RegExp(
  `^[\\s\\p{P}\\p{Emoji_Presentation}\\p{Extended_Pictographic}]*(и\\s+тебе|тебе\\s+тоже|взаимно|спасибо|спс|пасиб|ага|угу|ок|окей|хорошо|пока|давай|целую|обнимаю|до\\s+встречи)${WORD_END}`,
  'iu',
);
const ONLY_EMOJI_RX =
  /^[\s\p{P}\p{Emoji_Presentation}\p{Extended_Pictographic}‍️]+$/u;

export function isClosingOnly(text: string): boolean {
  const t = (text ?? '').trim();
  if (!t || t.length > 80 || t.includes('?')) return false;
  return isGoodnightText(t) || CLOSING_RX.test(t) || ONLY_EMOJI_RX.test(t);
}

interface HistoryLike {
  role: string;
  content?: string;
  created_at?: number;
}

function saidRecently(
  history: readonly HistoryLike[],
  test: (s: string) => boolean,
  nowTs: number,
  withinSeconds: number,
): boolean {
  return history.some(
    (m) =>
      m.role === 'assistant' &&
      typeof m.created_at === 'number' &&
      nowTs - m.created_at <= withinSeconds &&
      !String(m.content ?? '').startsWith('[Реакция') &&
      test(String(m.content ?? '')),
  );
}

export const saidGoodnightRecently = (
  history: readonly HistoryLike[],
  nowTs: number,
) => saidRecently(history, isGoodnightText, nowTs, 10 * 3600);

export const saidMorningRecently = (
  history: readonly HistoryLike[],
  nowTs: number,
) => saidRecently(history, isMorningText, nowTs, 12 * 3600);

export function dropRepeatedFarewell(
  reply: string,
  drop: { goodnight: boolean; morning: boolean },
): string {
  if (!drop.goodnight && !drop.morning) return reply;
  const lines = reply.split('\n').map((line) => {
    let out = line;
    for (const [on, rx] of [
      [drop.goodnight, GOODNIGHT_FRAGMENT],
      [drop.morning, MORNING_RX],
    ] as const) {
      if (!on) continue;
      const m = rx.exec(out);
      if (!m) continue;
      const before = out.slice(0, m.index).replace(/[\s,;:—-]+$/u, '');
      out = /[\p{L}\p{N}]/u.test(before) ? before : '';
    }
    return out;
  });
  return lines
    .filter((l, i) => l.trim() || (i > 0 && lines[i - 1]!.trim()))
    .join('\n')
    .trim();
}

export function farewellNote(
  drop: { goodnight: boolean; morning: boolean },
  gender: Gender = 'female',
): string {
  const g = voiceOf(gender);
  const notes: string[] = [];
  if (drop.goodnight) {
    notes.push(
      `Ты уже ${g.v('пожелала', 'пожелал')} ${g.they.to} спокойной ночи. Не прощайся и не желай спокойной ночи снова — ни дословно, ни другими словами. Если ${g.they.he} о чём-то ${g.c('спросил', 'спросила')}, ответь коротко.`,
    );
  }
  if (drop.morning)
    notes.push(
      `Сегодня утром ты уже ${g.v('поздоровалась', 'поздоровался')}. Не пиши «доброе утро» ещё раз, просто продолжай разговор.`,
    );
  return notes.join('\n');
}
