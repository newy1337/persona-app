export const LEAD_STATUSES = [
  'pending',
  'queued',
  'assigned',
  'contacted',
  'replied',
  'dead',
] as const;
export type LeadStatus = (typeof LEAD_STATUSES)[number];

/**
 * Лид в буфере: пришёл по API только с ником, без телефона. Не раздаётся и не
 * виден в «Лидах»; хед и тимлиды региона берут его в работу или отклоняют.
 */
export const BUFFER_STATUS = 'buffer';

export const isLeadStatus = (v: unknown): v is LeadStatus =>
  typeof v === 'string' && (LEAD_STATUSES as readonly string[]).includes(v);

export const LEAD_GENDERS = ['m', 'f', 'unknown'] as const;

/** Куда писать лиду: Telegram или VK. Один номер может быть лидом в обоих. */
export const LEAD_CHANNELS = ['telegram', 'vk'] as const;
export type LeadChannel = (typeof LEAD_CHANNELS)[number];

export const MAX_OUTREACH_ATTEMPTS = 3;
export const RETRY_BACKOFF_S = 3600;
export const PEER_FLOOD_BACKOFF_S = 6 * 3600;
export const IMPORT_THROTTLE_BACKOFF_S = 3600;

export function normalizePhone(raw: string): string | null {
  let digits = String(raw ?? '').replace(/\D/g, '');
  if (!digits) return null;
  if (digits.length === 11 && digits.startsWith('8'))
    digits = `7${digits.slice(1)}`;
  // Мобильный без кода страны («9123456702»): доноры шлют и так; с «+9…»
  // такой номер не дозвонился бы никому.
  if (digits.length === 10 && digits.startsWith('9')) digits = `7${digits}`;
  if (digits.length < 10 || digits.length > 15) return null;
  return `+${digits}`;
}

export interface LeadDraft {
  phone_e164?: string | null;
  username?: string | null;
  channel?: LeadChannel;
  first_name?: string | null;
  city?: string | null;
  age?: number | null;
  site?: string | null;
  persona_id?: string | null;
}

export const leadKey = (d: {
  phone_e164?: string | null;
  username?: string | null;
  channel?: string | null;
}) => (d.channel === 'vk' ? 'VK ' : '') + (d.phone_e164 ?? `@${d.username}`);

const USERNAME_RE = /^[a-z][a-z0-9_]{3,31}$/;

export function normalizeUsername(raw: string): string | null {
  let v = String(raw ?? '').trim();
  v = v
    .replace(/^https?:\/\//i, '')
    .replace(/^(www\.)?(t\.me|telegram\.me|telegram\.dog)\//i, '');
  v = v.replace(/\/.*$/, '').replace(/^@/, '').toLowerCase();
  if (!USERNAME_RE.test(v) || /^\d+$/.test(v)) return null;
  return v;
}

const VK_LINK_RE = /^(https?:\/\/)?((www|m)\.)?vk\.(com|ru)\//i;
const VK_USERNAME_RE = /^(id\d+|[a-z0-9_.]{3,32})$/;

/** Ник VK: короткий адрес или idN; ссылка vk.com/… тоже подходит. */
export function normalizeVkUsername(raw: string): string | null {
  let v = String(raw ?? '')
    .trim()
    .replace(VK_LINK_RE, '');
  v = v
    .replace(/[/?#].*$/, '')
    .replace(/^@/, '')
    .toLowerCase();
  if (/^\d+$/.test(v)) v = `id${v}`;
  if (!VK_USERNAME_RE.test(v) || /^[\d_.]+$/.test(v) || v.startsWith('.'))
    return null;
  return v;
}

export const isVkLink = (raw: string) =>
  VK_LINK_RE.test(String(raw ?? '').trim());

/**
 * Телефон или ник. Ссылка vk.com/… сама делает лид VK, t.me/… — Telegram;
 * иначе канал задаёт форма.
 */
export function parseLeadContact(
  raw: string,
  channel: LeadChannel = 'telegram',
): Pick<LeadDraft, 'phone_e164' | 'username' | 'channel'> | null {
  const text = String(raw ?? '').trim();
  if (!text) return null;
  if (isVkLink(text)) channel = 'vk';
  else if (/t\.me\/|telegram\.(me|dog)\//i.test(text)) channel = 'telegram';
  const looksLikeUsername =
    /^@/.test(text) ||
    /t\.me\/|telegram\.(me|dog)\/|vk\.(com|ru)\//i.test(text) ||
    /[a-z_]/i.test(text.replace(/^\+/, ''));
  if (looksLikeUsername) {
    const username =
      channel === 'vk' ? normalizeVkUsername(text) : normalizeUsername(text);
    return username ? { username, phone_e164: null, channel } : null;
  }
  const phone = normalizePhone(text);
  return phone ? { phone_e164: phone, username: null, channel } : null;
}

export interface ParsedLeads {
  items: LeadDraft[];
  errors: string[];
  duplicates: number;
}

export function parseLeadLines(
  text: string,
  channel: LeadChannel = 'telegram',
): ParsedLeads {
  const items: LeadDraft[] = [];
  const errors: string[] = [];
  const seen = new Set<string>();
  let duplicates = 0;
  const lines = String(text ?? '').split(/\r?\n/);
  lines.forEach((line, i) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) return;
    const parts = trimmed.split(/[;,\t|]/).map((p) => p.trim());
    const contact = parseLeadContact(parts[0], channel);
    if (!contact) {
      errors.push(
        `строка ${i + 1}: не похоже на телефон или ${channel === 'vk' ? 'ник VK' : '@username'} — «${parts[0]}»`,
      );
      return;
    }
    const key = leadKey(contact);
    if (seen.has(key)) {
      duplicates += 1;
      return;
    }
    seen.add(key);
    const age = parts[3] ? Number(parts[3]) : null;
    items.push({
      ...contact,
      first_name: parts[1] || null,
      city: parts[2] || null,
      age: Number.isInteger(age) && age > 0 && age < 120 ? age : null,
      site: parts[4] || null,
    });
  });
  return { items, errors, duplicates };
}

export function floodRetryAfter(e: any): number | null {
  const msg = String(e?.errorMessage ?? e?.message ?? '');
  if (typeof e?.seconds === 'number' && /FLOOD/i.test(msg))
    return Math.max(60, e.seconds);
  if (/PEER_FLOOD/i.test(msg)) return PEER_FLOOD_BACKOFF_S;
  if (/FLOOD_WAIT_(\d+)/.test(msg))
    return Math.max(60, Number(/FLOOD_WAIT_(\d+)/.exec(msg)[1]));
  return null;
}

const MSK_OFFSET_S = 3 * 3600;

export function mskDayStart(ts: number): number {
  return Math.floor((ts + MSK_OFFSET_S) / 86400) * 86400 - MSK_OFFSET_S;
}

export function withinOutreachHours(
  ts: number,
  hours: [number, number],
): boolean {
  const hour = Math.floor((ts + MSK_OFFSET_S) / 3600) % 24;
  return hour >= hours[0] && hour < hours[1];
}

export function mskClock(ts: number): string {
  return new Date(ts * 1000).toLocaleTimeString('ru-RU', {
    timeZone: 'Europe/Moscow',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function releasedLeadError(
  accountLabel: string,
  reason: string,
  untilTs: number,
): string {
  return `${accountLabel}: ${reason} до ${mskClock(untilTs)} МСК — отдан другому аккаунту`;
}
