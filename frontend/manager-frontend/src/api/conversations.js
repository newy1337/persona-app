import { api, ApiError, authHeaders } from './client';

export function getConversations() {
  return api.get('/api/manager/conversations').then((r) => r.items ?? []);
}

export function getHiddenConversations() {
  return api.get('/api/manager/conversations?hidden=1').then((r) => r.items ?? []);
}

export function setConversationHidden(chatId, hidden) {
  return api.post(`/api/conversations/${chatId}/${hidden ? 'hide' : 'unhide'}`);
}

export function getLiveConversations() {
  return api.get('/api/manager/conversations?active=1').then((r) => r.items ?? []);
}

export function getNeedManagerAssist() {
  return api.get('/api/manager/queue').then((r) => r.items ?? []);
}

export function getConversationById(chatId) {
  return api.get(`/api/conversations/${chatId}`);
}

export function getConversationRevision(chatId) {
  return api.get(`/api/conversations/${chatId}/revision`);
}

export function setChatNote(chatId, text) {
  return api.put(`/api/conversations/${chatId}/note`, { text });
}

export function getPauseStatus(chatId, personaId) {
  return api.get(
    `/api/operator/status/${chatId}?persona=${encodeURIComponent(personaId || '')}`,
  );
}

export async function downloadChatHtml(chatId) {
  const res = await fetch(`/api/conversations/${chatId}/export.html`, { headers: authHeaders() });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.message || `HTTP ${res.status}`);
  }
  const blob = await res.blob();
  const header = res.headers.get('content-disposition') || '';
  const star = /filename\*=UTF-8''([^;]+)/i.exec(header);
  const plain = /filename="([^"]+)"/i.exec(header);
  const name = star ? decodeURIComponent(star[1]) : plain ? plain[1] : `chat_${chatId}.html`;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
  return name;
}

export function editMessage(chatId, messageId, text) {
  return api.put(`/api/conversations/${chatId}/messages/${messageId}`, { text });
}

export function getMediaGallery(chatId) {
  return api.get(`/api/conversations/${chatId}/media-gallery`).then((r) => r.items ?? []);
}

export function sendAlbum(chatId, { sources, caption, replyTo }) {
  return api.post(`/api/conversations/${chatId}/album`, {
    sources,
    caption: caption || undefined,
    reply_to: replyTo ?? undefined,
  });
}

export function getInboundMedia(chatId) {
  return api.get(`/api/conversations/${chatId}/media/inbound/list`).then((r) => r.items ?? []);
}

export function getBeats(chatId) {
  return api.get(`/api/conversations/${chatId}/beats`);
}

export function setAiMode(chatId, aiActive) {
  return api.post(`/api/conversations/${chatId}/${aiActive ? 'resume' : 'pause'}`);
}

export function answerNow(chatId) {
  return api.post(`/api/conversations/${chatId}/answer`);
}

export function sendMessage(chatId, text, { voice = false, replyTo = null } = {}) {
  return api.post(`/api/conversations/${chatId}/message`, { text, voice, reply_to: replyTo ?? undefined });
}

export async function uploadFile(chatId, file) {
  const res = await fetch(`/api/conversations/${chatId}/upload?name=${encodeURIComponent(file.name)}`, {
    method: 'POST',
    headers: { 'Content-Type': file.type || 'application/octet-stream', ...authHeaders() },
    body: file,
  });
  if (!res.ok) throw new ApiError(res.status, (await res.json().catch(() => ({}))).message || 'не удалось загрузить файл');
  return res.json();
}

export function sendAttachment(chatId, { kind, source, caption, replyTo }) {
  return api.post(`/api/conversations/${chatId}/attachment`, {
    kind,
    source,
    caption: caption || undefined,
    reply_to: replyTo ?? undefined,
  });
}

export function pinFact(chatId, key, value) {
  return api.post(`/api/conversations/${chatId}/pin-fact`, { key, value: String(value ?? '') });
}

export function setSlot(chatId, slotId, value) {
  return api.post(`/api/conversations/${chatId}/slot`, { slot_id: slotId, value: value || null });
}

export function sendReaction(chatId, messageId, emoji) {
  return api.post(`/api/conversations/${chatId}/reaction`, { message_id: messageId, emoji });
}
