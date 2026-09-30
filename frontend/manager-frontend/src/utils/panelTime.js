export const PANEL_TIME_ZONE = 'Europe/Moscow';
export const moscowDay = (date = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: PANEL_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
export const moscowMidnight = day => Date.parse(`${day}T00:00:00+03:00`);
export function moscowInputTimestamp(value) {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$/.test(value)) throw new Error('Укажите корректную дату и время по МСК');
  const ts = Date.parse(`${value}+03:00`) / 1000;
  if (!Number.isFinite(ts)) throw new Error('Укажите корректную дату и время по МСК');
  return ts;
}
