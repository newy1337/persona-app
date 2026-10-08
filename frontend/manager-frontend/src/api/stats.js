import { api } from './client';

export function getStats({ from, to } = {}) {
  const p = new URLSearchParams();
  if (from) p.set('from', from);
  if (to) p.set('to', to);
  const qs = p.toString();
  return api.get(`/api/manager/stats${qs ? `?${qs}` : ''}`);
}
