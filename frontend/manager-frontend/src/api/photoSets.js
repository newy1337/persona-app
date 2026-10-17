import { api, authHeaders, getToken } from './client';

export function getPhotoSets() {
  return api.get('/api/photo-sets');
}

export function createPhotoSet(name, regionCode) {
  return api.post('/api/photo-sets', { name, ...(regionCode ? { region_code: regionCode } : {}) });
}

/** Личности региона и образ каждой — его получат новые собеседники. */
export function getRegionAssignments(regionCode) {
  return api.get(`/api/photo-sets/assignments${regionCode ? `?region=${encodeURIComponent(regionCode)}` : ''}`);
}

export function assignRegionPhotoSet(personaSlug, setId, regionCode) {
  return api.put('/api/photo-sets/assignments', {
    persona_slug: personaSlug,
    set_id: setId,
    ...(regionCode ? { region_code: regionCode } : {}),
  });
}

export function getRegionStop() {
  return api.get('/api/operator/region-stop');
}

export function engageRegionStop(reason, regionCode) {
  return api.post('/api/operator/region-stop', {
    ...(reason ? { reason } : {}),
    ...(regionCode ? { region_code: regionCode } : {}),
  });
}

export function clearRegionStop(regionCode) {
  return api.delete(`/api/operator/region-stop${regionCode ? `?region=${encodeURIComponent(regionCode)}` : ''}`);
}

export function updatePhotoSet(id, patch) {
  return api.put(`/api/photo-sets/${id}`, patch);
}

export function deletePhotoSet(id) {
  return api.delete(`/api/photo-sets/${id}`);
}

function query(params = {}) {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v) q.set(k, v);
  const s = q.toString();
  return s ? `?${s}` : '';
}

export function getSetPhotos(id, params) {
  return api.get(`/api/photo-sets/${id}/photos${query(params)}`);
}

export async function uploadSetPhoto(id, file) {
  const res = await fetch(`/api/photo-sets/${id}/photos?name=${encodeURIComponent(file.name)}`, {
    method: 'POST',
    headers: { 'Content-Type': file.type || 'application/octet-stream', ...authHeaders() },
    body: file,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.message || `HTTP ${res.status}`), { detail: data.message });
  return data;
}

export function updateSetPhoto(photoId, patch) {
  return api.put(`/api/photo-sets/photos/${photoId}`, patch);
}

export function deleteSetPhoto(photoId) {
  return api.delete(`/api/photo-sets/photos/${photoId}`);
}

export function setAccountPhotoAutoSend(accountId, enabled) {
  return api.put(`/api/photo-sets/accounts/${accountId}/auto-send`, { enabled });
}

export function getChatLibrary(chatId, params) {
  return api.get(`/api/photo-sets/chat/${chatId}${query(params)}`);
}

export function sendLibraryPhoto(chatId, { photoId, caption, replyTo }) {
  return api.post(`/api/conversations/${chatId}/library-photo`, {
    photo_id: photoId,
    ...(caption ? { caption } : {}),
    ...(replyTo ? { reply_to: replyTo } : {}),
  });
}

export function photoUrl(photoId, thumb = false) {
  const token = getToken();
  const params = new URLSearchParams();
  if (thumb) params.set('thumb', '1');
  if (token) params.set('token', token);
  const s = params.toString();
  return `/api/photo-sets/photos/${photoId}/file${s ? `?${s}` : ''}`;
}
