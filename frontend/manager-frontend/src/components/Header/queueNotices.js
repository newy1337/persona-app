// Чаты «ждут менеджера» как уведомления: висят, пока менеджер не откроет чат
// или не закроет уведомление. Закрытые помнятся в этом браузере по ключу
// chat_id + момент попадания в очередь: тот же чат, попавший в очередь заново,
// придёт новым уведомлением.
import { REASON_LABEL } from '../AgentCard/AgentCard';

export const STORAGE_KEY = 'nastya_queue_dismissed';
export const MAX_AGE_S = 7 * 86400;

export const queueKey = (item) => `q:${item.chat_id}:${item.waiting_since ?? 0}`;

export function queueText(item) {
  const who = item.name || (item.client_username ? `@${item.client_username}` : `чат ${item.chat_id}`);
  const why = REASON_LABEL[item.queue_reason] ?? 'нужен менеджер';
  return `${who}: ${why}`;
}

export function loadDismissed(storage = globalThis.localStorage) {
  try {
    const raw = storage?.getItem(STORAGE_KEY);
    const data = raw ? JSON.parse(raw) : {};
    return data && typeof data === 'object' ? data : {};
  } catch {
    return {};
  }
}

export function saveDismissed(map, storage = globalThis.localStorage) {
  try {
    storage?.setItem(STORAGE_KEY, JSON.stringify(map));
  } catch {
    // приватный режим или заполненное хранилище: закрытия просто не переживут перезагрузку
  }
}

/** Снимает из памяти закрытия чатов, которых в очереди уже нет, и совсем старые. */
export function pruneDismissed(map, items, nowS = Date.now() / 1000) {
  const live = new Set(items.map(queueKey));
  const out = {};
  for (const [key, ts] of Object.entries(map)) {
    if (live.has(key) && nowS - Number(ts) < MAX_AGE_S) out[key] = ts;
  }
  return out;
}

export function normalizeQueue(data) {
  const items = Array.isArray(data?.items) ? data.items : Array.isArray(data) ? data : [];
  return items.filter((i) => i && Number.isFinite(Number(i.chat_id)));
}
