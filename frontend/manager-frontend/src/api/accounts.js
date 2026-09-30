import { api, authHeaders } from './client';

export function getAccounts() {
  return api.get('/api/tg-accounts');
}

export function addAccount(body) {
  return api.post('/api/tg-accounts', body);
}

export function setAccountStatus(id, status, reason) {
  return api.put(`/api/tg-accounts/${id}/status`, { status, reason });
}

export function setAccountProxy(id, proxy_config) {
  return api.post(`/api/tg-accounts/${id}/set-proxy`, { proxy_config });
}

export function updateAccount(id, patch) {
  return api.put(`/api/tg-accounts/${id}`, patch);
}

export function clearAccountFlood(id) {
  return api.post(`/api/tg-accounts/${id}/clear-flood`);
}

export function deleteAccount(id) {
  return api.delete(`/api/tg-accounts/${id}`);
}

export function getLiveState() {
  return api.get('/api/state');
}

export const authFlow = {
  start: (accountId) => api.post(`/api/tg-accounts/${accountId}/auth`),
  status: (jobId) => api.get(`/api/tg-accounts/auth/${jobId}`),
  code: (jobId, code) => api.post(`/api/tg-accounts/auth/${jobId}/sms-code`, { code }),
  password: (jobId, password) => api.post(`/api/tg-accounts/auth/${jobId}/2fa`, { password }),
  cancel: (jobId) => api.delete(`/api/tg-accounts/auth/${jobId}`),
};

export function getAccountPrivacy(id) {
  return api.get(`/api/tg-accounts/${id}/privacy`);
}

export function setAccountPrivacy(id, hideLastSeen) {
  return api.put(`/api/tg-accounts/${id}/privacy`, { hide_last_seen: hideLastSeen });
}

export function updateAccountProfile(id, body) {
  return api.put(`/api/tg-accounts/${id}/profile`, body);
}

export async function uploadAccountAvatar(id, file) {
  const res = await fetch(`/api/tg-accounts/${id}/avatar`, {
    method: 'POST',
    headers: { 'Content-Type': file.type || 'application/octet-stream', ...authHeaders() },
    body: file,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.message || `HTTP ${res.status}`), { detail: data.message });
  return data;
}
