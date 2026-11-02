import { api } from './client';

export function getUsage({ from, to } = {}) {
  const p = new URLSearchParams();
  if (from) p.set('from', from);
  if (to) p.set('to', to);
  const qs = p.toString();
  return api.get(`/api/stats${qs ? `?${qs}` : ''}`);
}

export function getManagerUsage({ from, to } = {}) {
  const p = new URLSearchParams();
  if (from) p.set('from', from);
  if (to) p.set('to', to);
  const qs = p.toString();
  return api.get(`/api/stats/managers${qs ? `?${qs}` : ''}`);
}

export function getDealStages({ from, to } = {}) {
  const p = new URLSearchParams();
  if (from) p.set('from', from);
  if (to) p.set('to', to);
  const qs = p.toString();
  return api.get(`/api/stats/stages${qs ? `?${qs}` : ''}`);
}

export function getColdLeads({ from, to } = {}) {
  const p = new URLSearchParams();
  if (from) p.set('from', from);
  if (to) p.set('to', to);
  const qs = p.toString();
  return api.get(`/api/stats/cold${qs ? `?${qs}` : ''}`);
}

export function getBalance() {
  return api.get('/api/stats/balance');
}

export function getPrices() {
  return api.get('/api/stats/prices');
}

export function putPrices(table) {
  return api.put('/api/stats/prices', table);
}

export function resetPrices() {
  return api.delete('/api/stats/prices');
}

/** Лиды по источнику трафика: по регионам, статусам и этапам; source — фильтр. */
export function getTrafficSources({ from, to, source } = {}) {
  const p = new URLSearchParams();
  if (from) p.set('from', from);
  if (to) p.set('to', to);
  if (source) p.set('source', source);
  const qs = p.toString();
  return api.get(`/api/stats/sources${qs ? `?${qs}` : ''}`);
}
