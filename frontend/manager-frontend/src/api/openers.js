import { api } from './client';

/** Первые сообщения по регионам: хеду — его регион, админу — выбранный. */
export function getRegionOpeners(region) {
  return api.get(`/api/region-openers${region ? `?region=${encodeURIComponent(region)}` : ''}`);
}

/** Пул региона для личности; пустой текст — вернуться к общему пулу личности. */
export function putRegionOpener(region, slug, text) {
  return api.put(`/api/region-openers/${encodeURIComponent(region)}/${encodeURIComponent(slug)}`, { text });
}
