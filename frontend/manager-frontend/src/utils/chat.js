import { getToken } from '../api/client';

export function authorClass(msg) {
  if (msg.role === 'user') return 'client';
  return String(msg.author || '').startsWith('operator:') ? 'manager' : 'bot';
}

export function fmtChatDate(ts) {
  if (!ts) return '';
  return new Date(ts * 1000).toLocaleDateString('ru-RU', { timeZone: 'Europe/Moscow',
    weekday: 'short',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

const readKey = (chatId) => `chutter_mgr_read_v1:${chatId}`;

export function loadReadCursor(chatId) {
  try {
    const raw = window.localStorage?.getItem(readKey(chatId));
    const n = raw == null ? -1 : Number(raw);
    return Number.isFinite(n) ? n : -1;
  } catch {
    return -1;
  }
}

export function saveReadCursor(chatId, index) {
  try {
    window.localStorage?.setItem(readKey(chatId), String(index));
  } catch {
  }
}

export function mediaKind(content) {
  const m = /^\[media:([a-z_]+)\]$/.exec(String(content || '').trim());
  return m ? m[1] : null;
}

export function telegramReadMark(msg, kind) {
  if (msg?.tg_read === null || msg?.tg_read === undefined) return null;
  if (kind === 'client') {
    return msg.tg_read
      ? { icon: '✓✓', read: true, title: 'Аккаунт прочитал в Telegram' }
      : { icon: '●', read: false, title: 'Аккаунт ещё не открыл это сообщение в Telegram' };
  }
  return msg.tg_read
    ? { icon: '✓✓', read: true, title: 'Собеседник прочитал в Telegram' }
    : { icon: '✓', read: false, title: 'Доставлено, собеседник ещё не прочитал' };
}

export function withToken(url) {
  if (!url || !String(url).startsWith('/api/')) return url;
  const token = getToken();
  if (!token) return url;
  return `${url}${url.includes('?') ? '&' : '?'}token=${encodeURIComponent(token)}`;
}

export function mediaUrl(chatId, ts) {
  const token = getToken();
  return `/api/conversations/${chatId}/media/${ts}${token ? `?token=${encodeURIComponent(token)}` : ''}`;
}

export const ACTIVE_WINDOW_S = 24 * 3600;

export function liveRows(rows) {
  const since = Math.floor(Date.now() / 1000) - ACTIVE_WINDOW_S;
  return (rows ?? []).filter((r) => (r.last_message_ts ?? 0) >= since);
}
