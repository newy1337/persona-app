import { api } from './client';

// Список шаблонов меняется редко: один запрос на вкладку, повторно — после правки.
let cache = null;

export function getQuickReplies({ fresh = false } = {}) {
  if (!cache || fresh) cache = api.get('/api/quick-replies').then((r) => r.items ?? []).catch((e) => { cache = null; throw e; });
  return cache;
}

export function putQuickReplies(items) {
  return api.put('/api/quick-replies', { items }).then((r) => {
    cache = Promise.resolve(r.items ?? []);
    return r.items ?? [];
  });
}

/** Подстановка в шаблон: {name} — имя собеседника, если оно известно. */
export function fillTemplate(text, { name } = {}) {
  return String(text ?? '').replace(/\{name\}/g, name || '');
}
