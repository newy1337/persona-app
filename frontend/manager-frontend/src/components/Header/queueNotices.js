// Чаты «ждут менеджера» как уведомления: висят, пока менеджер не откроет чат
// или не закроет уведомление. Закрытые помнятся в этом браузере по ключу
// chat_id + момент попадания в очередь: тот же чат, попавший в очередь заново,
// придёт новым уведомлением.
import { REASON_LABEL } from '../AgentCard/AgentCard';

export const STORAGE_KEY = 'nastya_queue_dismissed';
/** Баннеры, которые уже показывались в этой вкладке: второй раз не всплывают, живут в колокольчике. */
export const SHOWN_KEY = 'nastya_queue_banner_shown';
export const BANNER_MS = 3000;
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

export function loadShown(storage = globalThis.sessionStorage) {
  try {
    const raw = storage?.getItem(SHOWN_KEY);
    const list = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(list) ? list : []);
  } catch {
    return new Set();
  }
}

export function saveShown(set, storage = globalThis.sessionStorage) {
  try {
    storage?.setItem(SHOWN_KEY, JSON.stringify([...set].slice(-500)));
  } catch {
    // без sessionStorage баннер просто покажется ещё раз после перехода по страницам
  }
}

/**
 * Баннеры голосовых: какой самый свежий уже всплывал у этого пользователя в этом
 * браузере. Всплывают только уведомления новее него — иначе то же уведомление
 * выскакивало бы на каждой странице, а после закрытия по очереди всплыли бы
 * все старые непрочитанные. Прочитать их можно в колокольчике.
 */
export const VOICE_SEEN_KEY = 'nastya_voice_banner_seen';

export function loadVoiceSeen(userId, storage = globalThis.localStorage) {
  try {
    const raw = storage?.getItem(`${VOICE_SEEN_KEY}:${userId}`);
    const n = raw == null ? NaN : Number(raw);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

export function saveVoiceSeen(userId, id, storage = globalThis.localStorage) {
  try {
    storage?.setItem(`${VOICE_SEEN_KEY}:${userId}`, String(id));
  } catch {
    // приватный режим: баннер может всплыть ещё раз после перезагрузки, не страшно
  }
}

/** Звук на новый чат в очереди: выбор менеджера в этом браузере, по умолчанию включён. */
export const SOUND_KEY = 'queue_sound';
export function loadSound(storage = globalThis.localStorage) {
  try {
    return storage?.getItem(SOUND_KEY) !== 'off';
  } catch {
    return true;
  }
}
export function saveSound(on, storage = globalThis.localStorage) {
  try {
    storage?.setItem(SOUND_KEY, on ? 'on' : 'off');
  } catch {
    // приватный режим — выбор не переживёт перезагрузку
  }
}

/** Короткий двойной сигнал без файла: два тона через WebAudio. Браузер без звука — молча. */
export function beep() {
  try {
    const Ctx = globalThis.AudioContext || globalThis.webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    [[880, 0], [1175, 0.16]].forEach(([freq, at]) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, ctx.currentTime + at);
      gain.gain.exponentialRampToValueAtTime(0.18, ctx.currentTime + at + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + at + 0.14);
      osc.connect(gain).connect(ctx.destination);
      osc.start(ctx.currentTime + at);
      osc.stop(ctx.currentTime + at + 0.15);
    });
    setTimeout(() => ctx.close?.(), 600);
  } catch {
    // автозапуск звука запрещён до первого клика по странице — остаётся баннер
  }
}
