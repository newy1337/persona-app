import { api } from './client';

export function getManagers() {
  return api.get('/api/managers');
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
