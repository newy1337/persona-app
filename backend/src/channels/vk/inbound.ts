import type { InboundMedia } from 'src/brain/reply-brain.port';
import type { ClientActivity } from 'src/shared/presence.service';

/**
 * Разбор событий Long Poll VK (lp_version=21) — без сети и базы.
 *
 * Кортежи событий (снято живьём в Chutter 13.10, сверено с vk-desktop):
 *
 *     [10004, cmid, flags, minorSortId, peer, ts, text, additional, attachments, random_id, message_id, upd_ts]
 *     [10005|10018, cmid, flags, peer, ts, text, additional, attachments, random_id, message_id, upd_ts]
 *     [10006|10007, peer, lastCmid, unread, lastMessageId]
 *     [63…68, peer, [typingPeerIds…], total, ts]
 *
 * Id сообщения у нас — cmid (номер в диалоге): по нему VK отмечает
 * прочтение, ставит реакции, правит и удаляет. Глобальный message_id нужен
 * только для messages.getById.
 */

export const EVENT_MESSAGE_NEW = 10004;
export const EVENT_MESSAGE_EDIT = 10005;
export const EVENT_MESSAGE_UPDATE = 10018;
export const EVENT_READ_INBOX = 10006;
export const EVENT_READ_OUTBOX = 10007;

/** Бит «исходящее» во flags сообщения. */
const FLAG_OUTBOX = 2;

/** Поля события-сообщения: у правки нет minorSortId, поэтому позиции сдвинуты. */
const NEW_FIELDS = {
  cmid: 1,
  flags: 2,
  peer: 4,
  ts: 5,
  text: 6,
  additional: 7,
  attachments: 8,
  randomId: 9,
  messageId: 10,
  minLen: 12,
};
const EDIT_FIELDS: typeof NEW_FIELDS = {
  cmid: 1,
  flags: 2,
  peer: 3,
  ts: 4,
  text: 5,
  additional: 6,
  attachments: 7,
  randomId: 8,
  messageId: 9,
  minLen: 11,
};

/** 63–68: печатает, записывает голосовое, грузит фото/видео/файл, записывает кружок. */
const TYPING: Record<number, ClientActivity> = {
  63: 'typing',
  64: 'voice',
  65: 'photo',
  66: 'photo',
  67: 'file',
  68: 'video_note',
};

/** Беседы — peer 2e9…3e9; сообщества — отрицательные. Новые id людей 12-значные (выше бесед). */
const CHAT_PEER_MIN = 2_000_000_000;
const CHAT_PEER_MAX = 3_000_000_000;
/** Служебные аккаунты VK (100 — «Администрация»). */
const SERVICE_PEERS = new Set([100]);

export const isPersonPeer = (peer: number): boolean =>
  peer > 0 &&
  !(peer >= CHAT_PEER_MIN && peer < CHAT_PEER_MAX) &&
  !SERVICE_PEERS.has(peer);

/** Сообщение в форме DTO VK (messages.getById / getHistory). */
export interface VkMessage {
  id: number;
  conversation_message_id: number;
  peer_id: number;
  from_id?: number;
  date: number;
  text: string;
  out?: number | boolean;
  random_id?: number;
  attachments?: Array<{ type: string; [k: string]: unknown }>;
  fwd_messages?: VkMessage[];
  reply_message?: { conversation_message_id?: number };
}

export type VkEvent =
  /** thin — в событии мало данных, сообщение надо дочитать getById(message.id). */
  | { kind: 'message'; message: VkMessage; outgoing: boolean; thin: boolean }
  | { kind: 'edit'; peer: number; cmid: number; text: string }
  | { kind: 'read'; side: 'inbox' | 'outbox'; peer: number; cmid: number }
  | { kind: 'typing'; peer: number; activity: ClientActivity; ts: number };

/** Текст события: `<br>` → перенос, HTML-сущности разворачиваются (API-текст уже чистый). */
export function eventText(raw: unknown): string {
  const text = String(raw ?? '');
  if (!text.includes('&') && !/<br/i.test(text)) return text;
  return text
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(
      /&(#\d+|#x[\da-f]+|quot|amp|lt|gt|apos|nbsp);/gi,
      (m, e: string) => {
        const k = e.toLowerCase();
        if (k === 'quot') return '"';
        if (k === 'amp') return '&';
        if (k === 'lt') return '<';
        if (k === 'gt') return '>';
        if (k === 'apos') return "'";
        if (k === 'nbsp') return ' ';
        const code = k.startsWith('#x')
          ? parseInt(k.slice(2), 16)
          : parseInt(k.slice(1), 10);
        return Number.isFinite(code) ? String.fromCodePoint(code) : m;
      },
    );
}

const obj = (v: unknown): Record<string, unknown> =>
  v && typeof v === 'object' && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : {};

/**
 * Вложения события → форма DTO. В `attachments.attachments` VK кладёт
 * JSON-строку с теми же объектами, что отдаёт getById (одно голосовое или
 * стикер — целиком). Иначе остаются ярлыки `attachN_type` без файла.
 */
function eventAttachments(
  att: Record<string, unknown>,
): VkMessage['attachments'] {
  const payload = String(att.attachments ?? '');
  if (payload.startsWith('[')) {
    try {
      const parsed: unknown = JSON.parse(payload);
      return Array.isArray(parsed)
        ? parsed.filter((a): a is { type: string } => !!obj(a).type)
        : [];
    } catch {
      return [];
    }
  }
  const out: NonNullable<VkMessage['attachments']> = [];
  for (let i = 1; i <= 10; i++) {
    const type = String(att[`attach${i}_type`] ?? '');
    if (type) out.push({ type, [type]: {} });
  }
  return out;
}

/**
 * Данных события не хватает (правило vk-desktop isEngineMessageInsufficient):
 * фото и документы приходят ярлыком без ссылки, несколько вложений, ответ и
 * пересланное — только в DTO, сжатое сервером событие короче нормы.
 */
function isThin(
  u: unknown[],
  len: number,
  att: Record<string, unknown>,
): boolean {
  if (u.length < len) return true;
  if (att.reply || att.fwd || att.fwd_count) return true;
  if (att.attach1_type) {
    if (att.attach2_type) return true;
    if (String(att.attachments_count ?? '1') !== '1') return true;
    return !String(att.attachments ?? '').startsWith('[');
  }
  return false;
}

/** Событие Long Poll → наше событие; то, на что бот не реагирует, — null. */
export function decodeEvent(update: unknown): VkEvent | null {
  if (!Array.isArray(update) || !update.length) return null;
  const code = Number(update[0]);
  if (
    code === EVENT_MESSAGE_NEW ||
    code === EVENT_MESSAGE_EDIT ||
    code === EVENT_MESSAGE_UPDATE
  ) {
    const f = code === EVENT_MESSAGE_NEW ? NEW_FIELDS : EDIT_FIELDS;
    if (update.length <= f.peer) return null;
    const peer = Number(update[f.peer]);
    const cmid = Number(update[f.cmid]);
    const outgoing = (Number(update[f.flags]) & FLAG_OUTBOX) !== 0;
    const att = obj(update[f.attachments]);
    const text = eventText(update[f.text]);
    if (code !== EVENT_MESSAGE_NEW) {
      // 10018 несёт и закрепление — это не правка текста; правку наугад не применяем.
      if (outgoing || !text || 'pinned_at' in obj(update[f.additional]))
        return null;
      if (isThin(update, f.minLen, att)) return null;
      return { kind: 'edit', peer, cmid, text };
    }
    return {
      kind: 'message',
      outgoing,
      thin: isThin(update, f.minLen, att),
      message: {
        id: Number(update[f.messageId] ?? 0),
        conversation_message_id: cmid,
        peer_id: peer,
        from_id: outgoing ? undefined : peer,
        date: Number(update[f.ts] ?? 0),
        text,
        out: outgoing ? 1 : 0,
        random_id: Number(update[f.randomId] ?? 0),
        attachments: eventAttachments(att),
        fwd_messages: att.fwd ? [{} as VkMessage] : [],
      },
    };
  }
  if (
    (code === EVENT_READ_INBOX || code === EVENT_READ_OUTBOX) &&
    update.length >= 3
  )
    return {
      kind: 'read',
      side: code === EVENT_READ_OUTBOX ? 'outbox' : 'inbox',
      peer: Number(update[1]),
      cmid: Number(update[2]),
    };
  if (TYPING[code] && update.length >= 5)
    return {
      kind: 'typing',
      peer: Number(update[1]),
      activity: TYPING[code],
      ts: Number(update[4]),
    };
  return null;
}

/** DTO из догрузки разрыва (getLongPollHistory) — сообщение целиком. */
export function fromDto(message: VkMessage): VkEvent {
  return { kind: 'message', message, outgoing: !!message.out, thin: false };
}

// ── Вложения ──────────────────────────────────────────────────────────────────

const STICKERS = new Set(['sticker', 'ugc_sticker', 'sticker_pack_preview']);
/** Кружки, пришедшие документом. */
const ROUND_DOC_EXTS = new Set(['ogv', 'webm']);
/** Качества mp4 входящего видео: не самое тяжёлое, но живое. */
const VIDEO_QUALITIES = [
  'mp4_480',
  'mp4_360',
  'mp4_720',
  'mp4_240',
  'mp4_1080',
];

/** Вложения, которые хода не создают, и как их назвать в ленте (как у Telegram). */
const UNKNOWN: Record<string, string> = {
  geo: 'геопозиция',
  poll: 'опрос',
  gift: 'подарок',
  story: 'история',
  call: 'звонок',
  group_call_in_progress: 'звонок',
  audio: 'музыка',
  audio_playlist: 'плейлист',
  market: 'товар',
  money_transfer: 'перевод',
  money_request: 'запрос денег',
  wall: 'запись',
  wall_reply: 'комментарий',
};

const types = (m: VkMessage) => (m.attachments ?? []).map((a) => a.type);

function attachment(m: VkMessage, type: string): Record<string, unknown> {
  return obj((m.attachments ?? []).find((a) => a.type === type)?.[type]);
}

/**
 * Пересланное голосовое без своих слов → как своё: VK кладёт его во вложенное
 * сообщение, а расшифровывать его нужно так же, как обычное.
 */
export function liftForwardedVoice(m: VkMessage): VkMessage {
  if (m.attachments?.length || m.text?.trim()) return m;
  const nested = (m.fwd_messages ?? []).find((f) =>
    types(f).includes('audio_message'),
  );
  return nested
    ? { ...m, attachments: nested.attachments, fwd_messages: [] }
    : m;
}

export interface VkInboundMedia {
  kind: InboundMedia['kind'];
  url: string | null;
  ext: string;
  duration?: number;
  name?: string;
  /** Расшифровка голосового от самого VK. */
  transcript?: string | null;
}

function videoUrl(payload: Record<string, unknown>): string | null {
  const files = obj(payload.files);
  for (const q of VIDEO_QUALITIES) if (files[q]) return String(files[q]);
  return null;
}

/** Что во вложениях сообщения и откуда это качать (ссылки CDN VK — тем же прокси). */
export function inboundMedia(m: VkMessage): VkInboundMedia | null {
  const t = new Set(types(m));
  if ([...t].some((x) => STICKERS.has(x))) {
    const s = attachment(
      m,
      [...t].find((x) => STICKERS.has(x))!,
    );
    const images = (s.images ?? s.images_with_background) as
      Array<{ url?: string }> | undefined;
    return { kind: 'sticker', url: images?.at(-1)?.url ?? null, ext: 'png' };
  }
  if (t.has('graffiti'))
    return {
      kind: 'animation',
      url: (attachment(m, 'graffiti').url as string) ?? null,
      ext: 'png',
    };
  if (t.has('video_message')) {
    const v = attachment(m, 'video_message');
    return {
      kind: 'video_note',
      url: videoUrl(v),
      ext: 'mp4',
      duration: Number(v.duration) || undefined,
    };
  }
  if (t.has('photo')) {
    const sizes = (attachment(m, 'photo').sizes ?? []) as Array<{
      url?: string;
      width?: number;
      height?: number;
    }>;
    const best = sizes
      .filter((s) => s.url)
      .sort(
        (a, b) =>
          (b.width ?? 0) * (b.height ?? 0) - (a.width ?? 0) * (a.height ?? 0),
      )[0];
    return { kind: 'photo', url: best?.url ?? null, ext: 'jpg' };
  }
  if (t.has('audio_message')) {
    const a = attachment(m, 'audio_message');
    const state = String(a.transcript_state ?? '');
    const transcript = String(a.transcript ?? '').trim();
    return {
      kind: 'voice',
      url: (a.link_ogg as string) || (a.link_mp3 as string) || null,
      ext: a.link_ogg ? 'ogg' : 'mp3',
      duration: Number(a.duration) || undefined,
      transcript:
        transcript && (state === '' || state === 'done') ? transcript : null,
    };
  }
  if (t.has('video')) {
    const v = attachment(m, 'video');
    return {
      kind: 'video',
      url: videoUrl(v),
      ext: 'mp4',
      duration: Number(v.duration) || undefined,
    };
  }
  if (t.has('doc')) {
    const d = attachment(m, 'doc');
    const ext = String(d.ext ?? '').toLowerCase();
    if (ext === 'gif')
      return { kind: 'animation', url: (d.url as string) ?? null, ext: 'gif' };
    return {
      kind: ROUND_DOC_EXTS.has(ext) ? 'video_note' : 'document',
      url: (d.url as string) ?? null,
      ext: ext.replace(/[^a-z0-9]/g, '').slice(0, 5) || 'bin',
      name: (d.title as string) || undefined,
    };
  }
  return null;
}

/** Адреса ссылок и репостов: у VK они приходят вложением, в тексте их нет. */
function linkUrls(m: VkMessage): string[] {
  const urls: string[] = [];
  for (const a of m.attachments ?? []) {
    const p = obj(a[a.type]);
    if ((a.type === 'link' || a.type === 'article') && p.url)
      urls.push(String(p.url));
    else if (a.type === 'wall' && p.id !== undefined)
      urls.push(
        `https://vk.com/wall${String(p.owner_id ?? p.from_id)}_${String(p.id)}`,
      );
  }
  return urls;
}

/**
 * Текст хода. Пересланное — своя подпись и пересланный текст вместе; ссылки —
 * в текст (иначе менеджер видит пустоту); вложение без медиа и без текста —
 * ярлыком, как `[геопозиция]` у Telegram.
 */
export function inboundText(
  m: VkMessage,
  media: VkInboundMedia | null,
): string {
  const own = (m.text ?? '').trim();
  const nested = (m.fwd_messages ?? [])
    .map((f) => (f.text ?? '').trim())
    .filter(Boolean)
    .join(' ');
  const links = linkUrls(m).filter((u) => !own.includes(u));
  const body = [own, nested, ...links].filter(Boolean).join(' ');
  if (body || media) return body;
  if ((m.fwd_messages ?? []).length) return '[пересланное сообщение]';
  const first = types(m)[0];
  return first ? `[${UNKNOWN[first] ?? `вложение: ${first}`}]` : '';
}
