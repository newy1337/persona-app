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
