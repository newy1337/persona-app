import { api } from './client';

/** Буфер: входящие лиды только с ником. Хеду и тимлиду — их регион, админу — выбранный или все. */
export function getBuffer(region) {
  return api.get(`/api/buffer${region ? `?region=${encodeURIComponent(region)}` : ''}`);
}

export function takeBuffered(id) {
  return api.post(`/api/buffer/${id}/take`, {});
}

export function declineBuffered(id, reason) {
  return api.post(`/api/buffer/${id}/decline`, reason ? { reason } : {});
}

/** Настройки регионов: принимать ли перезабив. */
export function getRegionSettings() {
  return api.get('/api/region-settings');
}

export function setAcceptReassigned(region, accept) {
  return api.put(`/api/region-settings/${encodeURIComponent(region)}`, { accept_reassigned: accept });
}
