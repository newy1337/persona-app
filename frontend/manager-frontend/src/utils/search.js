import { moscowDay, moscowMidnight } from './panelTime';
export function matchesQuery(row, query) {
  const q = String(query ?? '').trim().toLowerCase();
  if (!q) return true;

  const digits = q.replace(/\D/g, '');
  const phoneDigits = String(row.phone || '').replace(/\D/g, '');
  if (digits && phoneDigits && phoneDigits.includes(digits)) return true;

  return [row.name, row.city, row.chat_id, row.account_id, row.manager_username, row.region_code]
    .filter((v) => v != null && v !== '')
    .some((v) => String(v).toLowerCase().includes(q));
}

export function matchesHeadFilters(row, filters) {
  const { lead = '', account = '' } = filters ?? {};
  if (lead && (lead === 'manager' ? !row.is_paused : !!row.is_paused)) return false;
  if (account && String(row.account_id) !== account) return false;
  return true;
}

export function matchesDateFilter(row, dateFilter) {
  if (!dateFilter) return true;
  const ts = row.last_message_ts;
  if (!ts) return false;
  const DAY = 24 * 3600 * 1000;
  const now = new Date();
  const startToday = moscowMidnight(moscowDay(now));
  const rowTs = ts * 1000;

  if (dateFilter === 'today') return rowTs >= +startToday && rowTs < +startToday + DAY;
  if (dateFilter === 'yesterday') return rowTs >= +startToday - DAY && rowTs < +startToday;
  if (dateFilter === '7d') return rowTs >= Date.now() - 7 * DAY;
  if (dateFilter === '30d') return rowTs >= Date.now() - 30 * DAY;
  if (String(dateFilter).startsWith('date:')) {
    const [y, m, d] = dateFilter.slice(5).split('-').map(Number);
    if (!y || !m || !d) return true;
    const start = moscowMidnight(dateFilter.slice(5));
    return rowTs >= +start && rowTs < +start + DAY;
  }
  return true;
}
