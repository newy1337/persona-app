import { api } from './client';

// status и deal_stage — одно значение или несколько через запятую.
export function getLeads({ status, deal_stage, q, limit, offset } = {}) {
  const p = new URLSearchParams();
  if (status) p.set('status', status);
  if (deal_stage) p.set('deal_stage', deal_stage);
  if (q) p.set('q', q);
  if (limit != null) p.set('limit', String(limit));
  if (offset != null) p.set('offset', String(offset));
  const qs = p.toString();
  return api.get(`/api/leads${qs ? `?${qs}` : ''}`);
}

export function writeFromAnother(id) {
  return api.post(`/api/leads/${id}/write-from-another`);
}

export function getOutreachStatus() {
  return api.get('/api/leads/outreach');
}

export function createLead(body) {
  return api.post('/api/leads', body);
}

export function importLeads({ text, queue, persona_id }) {
  return api.post('/api/leads/import', { text, queue, persona_id: persona_id || undefined });
}

export function getLeadPersonas() {
  return api.get('/api/leads/personas');
}

export function startOutreach(ids) {
  return api.post('/api/leads/start', ids ? { ids } : {});
}

export function stopOutreach(ids) {
  return api.post('/api/leads/stop', ids ? { ids } : {});
}

export function updateLead(id, patch) {
  return api.put(`/api/leads/${id}`, patch);
}

export function deleteLead(id, { telegram = false } = {}) {
  return api.delete(`/api/leads/${id}${telegram ? '?telegram=1' : ''}`);
}
