import { api } from './client';

export function getApiKeys() {
  return api.get('/api/api-keys');
}

export function createApiKey(name) {
  return api.post('/api/api-keys', { name });
}

export function revokeApiKey(id) {
  return api.delete(`/api/api-keys/${id}`);
}
