import { api } from './client';

export function getSettings() {
  return api.get('/api/settings');
}

export function updateSettings(patch) {
  return api.put('/api/settings', patch);
}
