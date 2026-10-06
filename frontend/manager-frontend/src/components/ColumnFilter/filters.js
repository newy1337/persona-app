import { moscowDay, moscowMidnight } from '../../utils/panelTime';

// Чистая логика фильтров колонок: её делят таблицы, где строки уже на
// клиенте (диалоги, аккаунты). Описание фильтра колонки (def):
//   { type: 'options', get(row), options: [{ value, label, count?, color? }] }
//   { type: 'text',    get(row), placeholder? }   — «содержит», get может вернуть массив строк
//   { type: 'period',  get(row) }                 — get возвращает время в секундах
// Значение: массив выбранных value / строка / ключ периода. Пустое — фильтра нет.

const DAY_MS = 24 * 3600 * 1000;

export const PERIODS = [
  { value: 'today', label: 'Сегодня' },
  { value: 'yesterday', label: 'Вчера' },
  { value: '7d', label: 'За 7 дней' },
  { value: '30d', label: 'За 30 дней' },
];

export function isActive(value) {
  if (Array.isArray(value)) return value.length > 0;
  return value != null && String(value).trim() !== '';
}

/** Сутки считаются по Москве, как и всё время в панели. */
export function inPeriod(ts, period, now = Date.now()) {
  if (!period) return true;
  const ms = Number(ts || 0) * 1000;
  if (!ms) return false;
  const start = moscowMidnight(moscowDay(new Date(now)));
  if (period === 'today') return ms >= start && ms < start + DAY_MS;
  if (period === 'yesterday') return ms >= start - DAY_MS && ms < start;
  if (period === '7d') return ms >= now - 7 * DAY_MS;
  if (period === '30d') return ms >= now - 30 * DAY_MS;
  return true;
}

const list = (raw) => (Array.isArray(raw) ? raw : [raw]);

export function matches(def, value, row, now = Date.now()) {
  if (!isActive(value)) return true;
  const raw = def.get(row);
  if (def.type === 'options') {
    const have = list(raw).map((v) => String(v ?? ''));
    return value.some((v) => have.includes(String(v)));
  }
  if (def.type === 'period') return inPeriod(raw, value, now);
  const needle = String(value).trim().toLowerCase();
  return list(raw)
    .filter((v) => v != null && v !== '')
    .some((v) => String(v).toLowerCase().includes(needle));
}

/** defs — { ключ колонки: def }, state — { ключ колонки: значение }. Лишние ключи state не мешают. */
export function applyFilters(rows, defs, state, now = Date.now()) {
  const active = Object.entries(defs).filter(([key, def]) => def && isActive(state?.[key]));
  if (!active.length) return rows;
  return rows.filter((row) => active.every(([key, def]) => matches(def, state[key], row, now)));
}

/**
 * Варианты для фильтра-списка из самих строк: значение, подпись и сколько
 * строк с ним. Пустое значение получает подпись empty (например «не назначен»).
 */
export function optionsFrom(rows, get, { label = (v) => v, empty = '—', order } = {}) {
  const counts = new Map();
  for (const row of rows ?? []) {
    for (const v of list(get(row))) {
      const key = String(v ?? '');
      counts.set(key, (counts.get(key) || 0) + 1);
    }
  }
  const out = [...counts].map(([value, count]) => ({ value, label: value === '' ? empty : String(label(value)), count }));
  if (order) return out.sort((a, b) => order(a.value) - order(b.value));
  return out.sort((a, b) => (a.value === '') - (b.value === '') || a.label.localeCompare(b.label, 'ru'));
}

/** Короткое описание заданного фильтра — для плашки над таблицей. */
export function describe(def, value) {
  if (!isActive(value)) return '';
  if (def.type === 'options') {
    return value
      .map((v) => def.options?.find((o) => String(o.value) === String(v))?.label ?? String(v))
      .join(', ');
  }
  if (def.type === 'period') return PERIODS.find((p) => p.value === value)?.label ?? '';
  return `«${String(value).trim()}»`;
}
