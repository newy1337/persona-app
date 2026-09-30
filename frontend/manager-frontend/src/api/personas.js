import { api } from './client';

export function getPersonas() {
  return api.get('/api/personas');
}

export function getPersona(id) {
  return api.get(`/api/personas/${id}`);
}

export function getPromptDefaults() {
  return api.get('/api/personas/prompts/defaults');
}

export function getRhythmDefaults() {
  return api.get('/api/personas/rhythm/defaults');
}

export function createPersona(body) {
  return api.post('/api/personas', body);
}

export function duplicatePersona(id) {
  return api.post(`/api/personas/${id}/duplicate`);
}

export function updatePersona(id, patch) {
  return api.put(`/api/personas/${id}`, patch);
}

export function setDefaultPersona(id) {
  return api.post(`/api/personas/${id}/default`);
}

export function deletePersona(id) {
  return api.delete(`/api/personas/${id}`);
}

export function exportPersona(id) {
  return api.get(`/api/personas/${id}/export`);
}

export function importPersona(id, sections, note) {
  return api.post(`/api/personas/${id}/import`, { sections, note });
}

export function putSection(id, section, data, note) {
  return api.put(`/api/personas/${id}/sections/${section}`, { data, note });
}

export function getVersions(id, section) {
  return api.get(`/api/personas/${id}/sections/${section}/versions`);
}

export function restoreVersion(id, section, versionId) {
  return api.post(`/api/personas/${id}/sections/${section}/versions/${versionId}/restore`);
}
