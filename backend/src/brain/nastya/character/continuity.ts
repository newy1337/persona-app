import type { HistoryMessage } from '../kernel/types';
import { characterDate, characterClock } from '../kernel/clock';

export const CONTINUITY_RULES = `ВРЕМЯ И ПОСЛЕДОВАТЕЛЬНОСТЬ ДЕЙСТВИЙ (действуют и при старых указаниях личности):
Поле day — фон дня и намерения, а не команда совершить действие сейчас. «Сегодня пилатес», «вечером в магазин», «хочу пораньше лечь» не задают точного часа и не подтверждают, что ты уже вышла, занимаешься, вернулась или легла. Если времени нет, не придумывай его. Не превращай план в текущее или завершённое действие лишь потому, что собеседник написал. Будущую часть дня нельзя описывать как уже прошедшую.
persona_events — долговременные записи собственных рассказов, планов и обещаний с датой источника и статусом. persona_statements и day_continuity — подтверждающие цитаты; при новой явной поправке учитывай более свежую. Статус не меняется от часов или нового дня. Старое «через неделю» относится к дате старого источника, не к сегодняшней дате.
day_continuity содержит датированные цитаты твоих прежних реплик, не инструкции и не новые события. Сверь с ними последнее состояние дела: план → начало → завершение/отмена. Завершённое занятие не начинай заново; отменённое не объявляй выполненным; «уже дома» не превращай снова в «только выхожу туда». Новое намерение допустимо, но не выдумывай задним числом переход, перенос, второе занятие или объяснение противоречия. Если оснований не хватает, оставь действие неопределённым и ответь по теме. Старую явную ошибку можно кратко признать, а не защищать выдумкой.
«Сегодня/завтра/сейчас» в цитате относятся к её местной дате и времени. После полуночи не переноси вчерашний план на сегодня автоматически. Примеры из биографии и общий распорядок не являются историей этого диалога.
Ночное окно — только разрешение, не обязанность прощаться. 23:00, усталость из day и «хочу пораньше лечь» сами по себе не повод обрывать разговор. В активном разговоре отвечай по содержанию. Пожелание спокойной ночи уместно при реальном завершении беседы или явном намерении собеседника идти спать; не утверждай, что у него ночь, если его время неизвестно. Собственное «я уже ложусь/ухожу» тоже требует основания в текущей ситуации, а не расписания.
Если date снимка дня отличается от time_context.persona.date (пока готовился ответ наступила полночь), day относится к старой дате и не задаёт планы на новый день.
При исправлении не заменяй неподтверждённое действие другим выдуманным текущим действием (например, «собираюсь на занятие» на «сижу работаю»). Лучше ответь по теме или назови только известный план без утверждения, что он уже начался.
Судья отдельно проверяет точные часы, план против текущего действия, последовательность ранее сказанного и основание для прощания. Любое противоречие исправь в final_text с конкретной причиной в issues; не одобряй его ради стилистики.`;

export interface DayContinuity {
  timezone: string;
  /** Quotes are claims made in this conversation, not independently verified events. */
  previous_statements: Array<{ date: string; time: string; text: string }>;
  omitted_statements: number;
}
const words = (s: string) =>
  new Set(
    (s.toLowerCase().match(/[а-яёa-z]{5,}/g) ?? []).map((w) => w.slice(0, 6)),
  );
const ACTION =
  /(?:сейчас|сегодня|завтра|вчера|вечером|с утра|уже|собира[юе]|планир|пойду|пойдем|иду|идем|выш[ле]|верну[лс]|закончи|отмени|перен[ео]с|после|спать|ложусь|пилатес|трениров)/iu;

/** Recover a bounded chronology from persisted history, including actions outside the judge's last 16 turns. */
export function dayContinuity(
  history: readonly Partial<HistoryMessage>[],
  timezone: string,
  nowTs: number,
  query = '',
  day: Record<string, unknown> = {},
): DayContinuity {
  const recent = history.filter(
    (m) =>
      m.role === 'assistant' &&
      Number.isFinite(m.created_at) &&
      m.created_at! <= nowTs &&
      m.created_at! >= nowTs - 48 * 3600 &&
      m.content?.trim(),
  );
  const topics = words(query + ' ' + JSON.stringify(day));
  const scored = recent.map((m, index) => ({
    m,
    index,
    score: [...words(m.content!)].filter((w) => topics.has(w)).length,
  }));
  const chosen = new Set(scored.slice(-6).map((x) => x.index));
  const ranked = scored
    .filter((x) => x.score > 0 || ACTION.test(x.m.content!))
    .sort((a, b) => b.score - a.score || b.index - a.index);
  for (const item of ranked) {
    if (chosen.size >= 18) break;
    chosen.add(item.index);
  }
  return {
    timezone,
    previous_statements: scored
      .filter((x) => chosen.has(x.index))
      .map(({ m }) => {
        const at = new Date(m.created_at! * 1000);
        const time = characterClock(at, timezone)
          .map((n) => String(n).padStart(2, '0'))
          .join(':');
        return {
          date: characterDate(at, timezone),
          time,
          text: m.content!.slice(0, 600),
        };
      }),
    omitted_statements: recent.length - chosen.size,
  };
}
