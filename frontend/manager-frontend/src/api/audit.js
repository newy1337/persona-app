import { api } from './client';

export function getAudit({ from, to, userId, action, failed, q, before } = {}) {
  const p = new URLSearchParams();
  if (from) p.set('from', from);
  if (to) p.set('to', to);
  if (userId) p.set('user_id', String(userId));
  if (action) p.set('action', action);
  if (failed) p.set('failed', '1');
  if (q) p.set('q', q);
  if (before) p.set('before', String(before));
  const qs = p.toString();
  return api.get(`/api/audit${qs ? `?${qs}` : ''}`);
}
