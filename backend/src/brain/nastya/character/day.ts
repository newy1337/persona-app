import { createHash } from 'node:crypto';
import { stripMetadata } from './config';

/**
 * The character's day.
 *
 * A hand-authored `state` wins on the day it is dated for. Otherwise each
 * facet is drawn from its pool by hashing the date, so the day is arbitrary
 * but stable: every turn of the same day sees the same weather and mood.
 */
export function dayState(
  dayConfig: Record<string, any>,
  today: string,
): Record<string, unknown> {
  if (
    dayConfig['date'] === today &&
    dayConfig['state'] &&
    typeof dayConfig['state'] === 'object'
  ) {
    return dayBackground(
      stripMetadata(dayConfig['state']) as Record<string, unknown>,
      today,
    );
  }
  if (dayConfig.weekly_plans && typeof dayConfig.weekly_plans === 'object') {
    const stamp = Date.parse(`${today}T12:00:00Z`);
    if (!Number.isFinite(stamp)) return dayBackground({}, today);
    const weekday = new Date(stamp).getUTCDay();
    const options = dayConfig.weekly_plans[String(weekday)];
    const usable = Array.isArray(options)
      ? options.filter(
          (p) =>
            p &&
            typeof p.id === 'string' &&
            typeof p.description === 'string' &&
            p.description.trim() &&
            !UNSUPPORTED_ACTION.test(p.description),
        )
      : [];
    const week = Math.floor((stamp / 86400000 - ((weekday + 6) % 7)) / 7);
    const selected = usable.length
      ? usable[((week % usable.length) + usable.length) % usable.length]
      : null;
    return {
      date: today,
      source: 'weekly_plan',
      weekday,
      background: {},
      plans: selected
        ? [
            {
              id: selected.id,
              description: selected.description.slice(0, 600),
              status: 'planned',
              time:
                typeof selected.time === 'string' &&
                /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(selected.time)
                  ? selected.time
                  : null,
              location:
                typeof selected.location === 'string'
                  ? selected.location.slice(0, 160)
                  : null,
            },
          ]
        : [],
      rule: 'Возможный план персонажа, не доказательство действия. Не объявляй его текущим или завершённым по часам. История и подтверждённые переносы важнее шаблона. План не требует сообщения и не отменяет уже рассказанные дела.',
    };
  }
  const result: Record<string, unknown> = {};
  for (const [key, choices] of Object.entries(dayConfig['pool'] ?? {})) {
    if (!Array.isArray(choices) || choices.length === 0) continue;
    const digest = createHash('sha256').update(`${today}:${key}`).digest();
    const index = Number(digest.readBigUInt64BE(0) % BigInt(choices.length));
    result[key] = choices[index];
  }
  return dayBackground(result, today);
}

const UNSUPPORTED_ACTION =
  /сейчас|уже|только что|закончил|вернул|сходил|сделал|поправил|разобрал|устроил|поработал|прош[её]л|прошла|съездил|купил|побывал|отменил|(?:^|[^\p{L}])(?:сижу|еду|иду|ложусь|собираюсь)(?=$|[^\p{L}])|уш[её]л|ушла|выш[её]л|вышла/iu;
const PLAN =
  /планир|хочу|намеч|пойду|поеду|буду|(?:сегодня|завтра|вечером|утром)\s+(?:у меня\s+)?(?:пилатес|йога|тренировка|прогулка|встреча|поход)/iu;
export function dayBackground(
  raw: Record<string, unknown>,
  date: string,
): Record<string, unknown> {
  const background: Record<string, unknown> = {};
  const plans: Array<{ description: string; status: 'planned'; time: null }> =
    [];
  for (const [key, value] of Object.entries(raw)) {
    if (
      typeof value !== 'string' ||
      !value.trim() ||
      UNSUPPORTED_ACTION.test(value)
    )
      continue;
    if (PLAN.test(value))
      plans.push({ description: value, status: 'planned', time: null });
    else if (/mood|energy|tone/i.test(key)) background[key] = value;
  }
  return {
    date,
    source: 'day_template',
    background,
    plans,
    rule: 'Не подтверждает начало или завершение дел. Время неизвестно; статус меняется только по рассказанным событиям. Данные шаблона не подтверждают фактическую погоду или местоположение.',
  };
}
