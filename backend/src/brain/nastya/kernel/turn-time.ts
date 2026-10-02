import type { Place } from './location';

export interface LocalTime extends Place {
  date: string | null;
  time: string | null;
  hour: number | null;
  offset_minutes: number | null;
  part_of_day: string | null;
}
export interface TurnTime {
  at_utc: string;
  persona: LocalTime;
  interlocutor: LocalTime;
  persona_ahead_minutes: number | null;
}

export const TIME_RULES = `РЕАЛЬНОЕ ВРЕМЯ: time_context вычислен сервером для ЭТОГО ответа и важнее догадок, старых сообщений, примеров и распорядка из биографии.
persona — ты; interlocutor — собеседник. Это разные часы и местные календарные даты. persona.city — где ты находишься сейчас; если биография упоминает другие города (родной, прошлый, где родня, куда собираешься), твои часы считаются по этому городу, а не по ним. Пустой persona.city не повод взять город из биографии: часы всё равно по persona.timezone. По persona_ahead_minutes: 0 — одинаковое время, положительное — ты впереди, отрицательное — позади. Учитывай именно число, не расстояние между странами. Рабочий график и родной город не меняют часы в месте текущего пребывания.
Не говори «у меня только обед», «у тебя утро», «у нас большая разница» без соответствия этим данным. При неизвестном месте часы и разница null: не угадывай, при необходимости уточни город/страну. Не принимай поздний приём пищи за местный полдень: можно «поздно обедаю», если это действительно уместно, но не выдумывать дневное время вечером.
Утро 05–11, день 12–16, вечер 17–22, ночь 23–04. Приветствие и предположения о сне собеседника сверяй с его часами. Прошлое, планы и время цитируемого сообщения отличай от текущего момента. Старые ошибочные реплики о времени не повторяй и не оправдывай выдуманной разницей.
Часы — служебные данные: не перечисляй их без повода, не упоминай time_context, сервер и настройки.`;

const localFormatters = new Map<string, Intl.DateTimeFormat>();
function localFormatter(timeZone: string): Intl.DateTimeFormat {
  let f = localFormatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-GB', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    });
    localFormatters.set(timeZone, f);
  }
  return f;
}

export function localTime(place: Place, at: Date): LocalTime {
  if (!place.timezone || place.status !== 'resolved')
    return {
      ...place,
      date: null,
      time: null,
      hour: null,
      offset_minutes: null,
      part_of_day: null,
    };
  const parts = localFormatter(place.timezone).formatToParts(at);
  const p = Object.fromEntries(parts.map((x) => [x.type, x.value]));
  const hour = Number(p.hour);
  const localUTC = Date.UTC(
    Number(p.year),
    Number(p.month) - 1,
    Number(p.day),
    hour,
    Number(p.minute),
    Number(p.second),
  );
  return {
    ...place,
    date: `${p.year}-${p.month}-${p.day}`,
    time: `${p.hour}:${p.minute}`,
    hour,
    offset_minutes: Math.round(
      (localUTC - Math.floor(at.getTime() / 1000) * 1000) / 60000,
    ),
    part_of_day:
      hour < 5 || hour >= 23
        ? 'ночь'
        : hour < 12
          ? 'утро'
          : hour < 17
            ? 'день'
            : 'вечер',
  };
}

export function turnTime(
  persona: Place,
  interlocutor: Place,
  at = new Date(),
): TurnTime {
  const own = localTime(persona, at),
    other = localTime(interlocutor, at);
  return {
    at_utc: at.toISOString(),
    persona: own,
    interlocutor: other,
    persona_ahead_minutes:
      own.offset_minutes === null || other.offset_minutes === null
        ? null
        : own.offset_minutes - other.offset_minutes,
  };
}

export function timeClaimIssues(text: string, ctx?: TurnTime): string[] {
  if (!ctx) return [];
  const issues: string[] = [];
  const parts: Record<string, (h: number) => boolean> = {
    утро: (h) => h >= 5 && h < 12,
    день: (h) => h >= 11 && h < 18,
    вечер: (h) => h >= 17 && h < 23,
    ночь: (h) => h >= 23 || h < 5,
    обед: (h) => h >= 11 && h < 16,
  };
  const t = text.toLowerCase().replace(/ё/g, 'е');
  const claim =
    /(?:^|[.!?\n]\s*|\s)(у меня|у тебя|у вас)\s+((?:(?:сейчас|тут|уже|еще|как раз|только|вообще|пока)\s+){0,5})(утро|день|вечер|ночь|обед|\d{1,2}:\d{2})(?![а-я])/g;
  for (const m of t.matchAll(claim)) {
    const who = m[1] === 'у меня' ? ctx.persona : ctx.interlocutor;
    const rest = t.slice((m.index ?? 0) + m[0].length);
    if (/^\s+(?:был|будет|рождения)/.test(rest)) continue;
    if (who.hour === null) {
      issues.push(
        `Нельзя утверждать «${m[0].trim()}»: местное время неизвестно`,
      );
      continue;
    }
    if (parts[m[3]]) {
      if (!parts[m[3]](who.hour))
        issues.push(
          `«${m[0].trim()}» не соответствует ${who.time} (${who.timezone})`,
        );
    } else {
      const [h, min] = m[3].split(':').map(Number),
        [realH, realMin] = who.time!.split(':').map(Number);
      const diff = Math.abs(h * 60 + min - realH * 60 - realMin);
      if (h > 23 || min > 59 || Math.min(diff, 1440 - diff) > 3)
        issues.push(`Названные часы ${m[3]} не соответствуют ${who.time}`);
    }
  }
  const different =
    /(?:разница\s+во\s+времени\s+(?:у нас\s+)?(?:не\s*маленькая|большая|огромная))|(?:у нас\s+(?:большая|огромная|немаленькая)\s+разница)/.test(
      t,
    );
  const same =
    /(?:у нас\s+(?:сейчас\s+)?(?:время\s+одинаковое|одинаковое\s+время))|(?:разницы\s+во\s+времени\s+нет)/.test(
      t,
    );
  if (
    different &&
    (ctx.persona_ahead_minutes === 0 || ctx.persona_ahead_minutes === null)
  )
    issues.push(
      'Заявленная разница во времени не подтверждается текущими часами',
    );
  if (same && ctx.persona_ahead_minutes !== 0)
    issues.push('Одинаковое время у обоих не подтверждено');
  return issues;
}
