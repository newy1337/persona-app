export const PANEL_TIME_ZONE = 'Europe/Moscow';
export const moscowDay = (date = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: PANEL_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
export const moscowMidnight = day => Date.parse(`${day}T00:00:00+03:00`);
export function moscowInputTimestamp(value) {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$/.test(value)) throw new Error('Укажите корректную дату и время по МСК');
  const ts = Date.parse(`${value}+03:00`) / 1000;
  if (!Number.isFinite(ts)) throw new Error('Укажите корректную дату и время по МСК');
  return ts;
}

const shiftDay = (day, n) => {
  const d = new Date(`${day}T12:00:00+03:00`);
  d.setUTCDate(d.getUTCDate() + n);
  return moscowDay(d);
};

/** Фильтр периода дашборда → дни по Москве для API статистики; пусто — вся история. */
export function rangeForFilter(dateFilter, now = new Date()) {
  const today = moscowDay(now);
  if (!dateFilter) return {};
  if (dateFilter === 'today') return { from: today, to: today };
  if (dateFilter === 'yesterday') return { from: shiftDay(today, -1), to: shiftDay(today, -1) };
  if (dateFilter === '7d') return { from: shiftDay(today, -6), to: today };
  if (dateFilter === '30d') return { from: shiftDay(today, -29), to: today };
  if (String(dateFilter).startsWith('date:')) {
    const day = dateFilter.slice(5);
    return /^\d{4}-\d{2}-\d{2}$/.test(day) ? { from: day, to: day } : {};
  }
  return {};
}
