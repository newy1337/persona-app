import { api } from './client';

/** Статистика региона: хеду — его регион, админу — выбранный. */
export function getRegionStats({ from, to, region } = {}) {
  const qs = new URLSearchParams(Object.entries({ from, to, region }).filter(([, v]) => v)).toString();
  return api.get(`/api/region-stats${qs ? `?${qs}` : ''}`);
}
