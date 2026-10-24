import { api } from './client';

export function getManagers({ from, to } = {}) {
  const p = new URLSearchParams();
  if (from) p.set('from', from);
  if (to) p.set('to', to);
  const qs = p.toString();
  return api.get(`/api/managers${qs ? `?${qs}` : ''}`);
}

export function createManager(body) {
  return api.post('/api/managers', body);
}

export function updateManager(userId, patch) {
  return api.put(`/api/managers/${userId}`, patch);
}

export function deleteManager(userId) {
  return api.delete(`/api/managers/${userId}`);
}

export function setAccountOwner(tgAccountId, user_id) {
  return api.put(`/api/managers/accounts/${tgAccountId}`, { user_id });
}

export function setAccountOwnerBulk(tg_account_ids, user_id) {
  return api.put('/api/managers/accounts', { tg_account_ids, user_id });
}
