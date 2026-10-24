import { api } from './client';

export function getSources() {
  return api.get('/api/sources');
}

export function createSource(name) {
  return api.post('/api/sources', { name });
}

export function deleteSource(id) {
  return api.delete(`/api/sources/${id}`);
}
