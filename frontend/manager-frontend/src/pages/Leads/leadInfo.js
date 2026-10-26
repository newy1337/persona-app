// Общее для таблицы лидов, карточки лида и воронки: тип лида, срок следующего
// шага и короткие даты. Время — московское, как во всей панели.

/** Тип лида: холодка (/api/post/cold) или хот (LeadGet, ручной ввод, импорт). */
export const LEAD_TYPES = [
  { value: 'cold', label: 'Холодка' },
  { value: 'hot', label: 'Хот' },
];
export const leadType = (row) => (row?.cold ? 'cold' : 'hot');
export const leadTypeLabel = (row) => (row?.cold ? 'Холодка' : 'Хот');

/** Фильтр «Тип»: холодка / хот и отдельно перезабив (он бывает у обоих). */
export const TYPE_FILTER = [...LEAD_TYPES, { value: 'reassigned', label: 'Перезабив' }];
export const matchesType = (row, values) =>
  values.length === 0 ||
  values.some((v) => (v === 'reassigned' ? row.reassigned : leadType(row) === v));

const MSK = 'Europe/Moscow';
const dayKey = (ts) => new Date(ts * 1000).toLocaleDateString('ru-RU', { timeZone: MSK });

/**
 * Срок следующего шага: none — шага нет, overdue — время прошло, today —
 * сегодня, later — позже, open — шаг записан без даты.
 */
export function nextStepState(row, now = Math.floor(Date.now() / 1000)) {
  if (!row?.next_step && !row?.next_step_at) return 'none';
  if (!row.next_step_at) return 'open';
  if (row.next_step_at <= now) return 'overdue';
  return dayKey(row.next_step_at) === dayKey(now) ? 'today' : 'later';
}

export const NEXT_FILTER = [
  { value: 'overdue', label: 'просрочен' },
  { value: 'today', label: 'сегодня' },
  { value: 'later', label: 'позже' },
  { value: 'open', label: 'без даты' },
  { value: 'none', label: 'нет шага' },
];

export const NEXT_TONE = {
  overdue: 'text-destructive',
  today: 'text-warning-foreground',
  later: 'text-muted-foreground',
  open: 'text-muted-foreground',
};

/** «25.10, 14:00» по Москве. */
export function shortDate(ts) {
  if (!ts) return '';
  return new Date(ts * 1000).toLocaleString('ru-RU', { timeZone: MSK, day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

/** Подпись срока шага: «просрочен · 25.10, 14:00», «сегодня 18:00», «27.10, 12:00». */
export function nextStepWhen(row, now) {
  const state = nextStepState(row, now);
  if (state === 'none' || state === 'open') return state === 'open' ? 'без даты' : '';
  if (state === 'today') {
    const time = new Date(row.next_step_at * 1000).toLocaleTimeString('ru-RU', { timeZone: MSK, hour: '2-digit', minute: '2-digit' });
    return row.next_step_at <= (now ?? Math.floor(Date.now() / 1000)) ? `просрочен · сегодня ${time}` : `сегодня ${time}`;
  }
  return state === 'overdue' ? `просрочен · ${shortDate(row.next_step_at)}` : shortDate(row.next_step_at);
}

/** unix ts в значение <input type="datetime-local"> (по Москве) и обратно. */
export function toLocalInput(ts) {
  if (!ts) return '';
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', { timeZone: MSK, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
      .formatToParts(new Date(ts * 1000))
      .map((p) => [p.type, p.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}

export function fromLocalInput(value) {
  if (!value) return null;
  // Москва — UTC+3 без перехода на летнее время.
  const ts = Date.parse(`${value}:00+03:00`);
  return Number.isNaN(ts) ? null : Math.floor(ts / 1000);
}

/** Кто ведёт чат лида: бот, менеджер или чата ещё нет. */
export const leadsBy = (row) => (!row?.telegram_user_id ? 'none' : row.is_paused ? 'manager' : 'bot');
export const LEADS_BY_FILTER = [
  { value: 'bot', label: 'бот' },
  { value: 'manager', label: 'менеджер' },
  { value: 'none', label: 'чата нет' },
];
