/**
 * Библиотека фото образа: даты снимков, лимиты автоотправки и то, как
 * отправленное фото выглядит в истории для модели. Без базы и без Telegram.
 */

export const SEND_MODES = ['request', 'initiative'] as const;
export type SendMode = (typeof SEND_MODES)[number];

export interface PhotoSetRules {
  autoSend: boolean;
  sendMode: string;
  minIntervalMin: number;
  maxPerDay: number;
  noRepeat: boolean;
}

export interface PhotoFacts {
  id: number;
  description: string;
  place: string | null;
  takenOn: string | null;
  details: string;
  tags: string[];
}

export type Freshness = 'today' | 'recent' | 'archive' | 'unknown';

const MONTHS_GEN = [
  'января',
  'февраля',
  'марта',
  'апреля',
  'мая',
  'июня',
  'июля',
  'августа',
  'сентября',
  'октября',
  'ноября',
  'декабря',
];
const MONTHS = [
  'январь',
  'февраль',
  'март',
  'апрель',
  'май',
  'июнь',
  'июль',
  'август',
  'сентябрь',
  'октябрь',
  'ноябрь',
  'декабрь',
];

const TAKEN_RX = /^(\d{4})(?:-(\d{2})(?:-(\d{2}))?)?$/;

/** YYYY, YYYY-MM или YYYY-MM-DD; всё остальное — «неизвестно» (null). */
export function normalizeTakenOn(raw: unknown): string | null {
  const text = String(raw ?? '').trim();
  const m = TAKEN_RX.exec(text);
  if (!m) return null;
  const year = Number(m[1]);
  if (year < 1900 || year > 2100) return null;
  if (m[2]) {
    const month = Number(m[2]);
    if (month < 1 || month > 12) return null;
    if (m[3]) {
      const day = Number(m[3]);
      const date = new Date(Date.UTC(year, month - 1, day));
      if (date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day)
        return null;
    }
  }
  return text;
}

export function formatTakenOn(takenOn: string | null): string {
  const m = takenOn ? TAKEN_RX.exec(takenOn) : null;
  if (!m) return 'дата неизвестна';
  if (m[3]) return `${Number(m[3])} ${MONTHS_GEN[Number(m[2]) - 1]} ${m[1]}`;
  if (m[2]) return `${MONTHS[Number(m[2]) - 1]} ${m[1]}`;
  return `${m[1]} год`;
}

const dayIndex = (iso: string): number => {
  const [y, mo, d] = iso.split('-').map(Number);
  return Math.floor(Date.UTC(y, mo - 1, d) / 86_400_000);
};

/**
 * Насколько снимок свежий относительно «сегодня» личности. Неточная дата
 * (только год или месяц) никогда не бывает «сегодня».
 */
export function photoFreshness(
  takenOn: string | null,
  today: string,
): Freshness {
  const m = takenOn ? TAKEN_RX.exec(takenOn) : null;
  if (!m) return 'unknown';
  if (!m[3]) {
    const sameMonth = m[2] && today.startsWith(`${m[1]}-${m[2]}`);
    return sameMonth ? 'recent' : 'archive';
  }
  const age = dayIndex(today) - dayIndex(takenOn!);
  if (age === 0) return 'today';
  if (age > 0 && age <= 7) return 'recent';
  return 'archive';
}

export const FRESHNESS_LABEL: Record<Freshness, string> = {
  today: 'снято сегодня',
  recent: 'снято на этой неделе',
  archive: 'архивный снимок',
  unknown: 'дата съёмки неизвестна',
};

/** «Только что», «прямо сейчас», «сегодня сняла» — уместно только у сегодняшнего фото. */
const FRESH_CLAIM_RX =
  /(только\s+что|прямо\s+сейчас|щас|вот\s+сейчас|сейчас\s+(?:с|на)?(?:фот|сним|щёлк|щелк)\S*|(?:с|на)?(?:фот|сним|щёлк|щелк)\S*\s+(?:только\s+что|сейчас|щас|сегодня)|сегодня\s+(?:с|на)?(?:фот|сним|щёлк|щелк)\S*|свеж(?:ее|ий|ая)\s+(?:фото|фотк|снимок|кадр)\S*)/giu;

export function freshClaims(text: string): string[] {
  return [...String(text ?? '').matchAll(FRESH_CLAIM_RX)].map((m) => m[0]);
}

/** Фраза «только что сняла» у несегодняшнего снимка — ложь о времени. */
export function hasFalseFreshClaim(
  text: string,
  freshness: Freshness,
): boolean {
  return freshness !== 'today' && freshClaims(text).length > 0;
}

/**
 * Последний рубеж, если генератор и проверка всё же написали «только что» к
 * архивному фото: убираем само утверждение о времени, остальное не трогаем.
 */
export function dropFreshClaims(text: string): string {
  return String(text ?? '')
    .replace(/\s*(?:только\s+что|прямо\s+сейчас|вот\s+сейчас)\s*/giu, ' ')
    .replace(/(?:^|\s)щас(?=\s|[,.!?]|$)/giu, ' ')
    .replace(
      /((?:с|на)?(?:фот|сним|щёлк|щелк)\S*)\s+(?:сейчас|сегодня)/giu,
      '$1',
    )
    .replace(
      /(?:сейчас|сегодня)\s+((?:с|на)?(?:фот|сним|щёлк|щелк)\S*)/giu,
      '$1',
    )
    .replace(/свеж(?:ее|ий|ая)\s+/giu, '')
    .replace(/ {2,}/g, ' ')
    .replace(/ ([,.!?])/g, '$1')
    .replace(/^ +| +$/gm, '');
}

export function parseTags(raw: unknown): string[] {
  let list: unknown = raw;
  if (typeof raw === 'string') {
    try {
      list = JSON.parse(raw);
    } catch {
      list = raw.split(',');
    }
  }
  if (!Array.isArray(list)) return [];
  const seen = new Set<string>();
  for (const item of list) {
    const tag = String(item ?? '')
      .trim()
      .toLowerCase()
      .replace(/^#/, '')
      .slice(0, 40);
    if (tag) seen.add(tag);
    if (seen.size >= 20) break;
  }
  return [...seen];
}

/** Что модель узнает о снимке из истории: без этого «как зовут кота?» ей не к чему привязать. */
export function photoNote(photo: PhotoFacts, today?: string): string {
  const parts = [photo.description.trim() || 'снимок без описания'];
  if (photo.place?.trim()) parts.push(`где: ${photo.place.trim()}`);
  parts.push(`когда: ${formatTakenOn(photo.takenOn)}`);
  if (today && photo.takenOn)
    parts.push(FRESHNESS_LABEL[photoFreshness(photo.takenOn, today)]);
  if (photo.details.trim()) parts.push(`детали: ${photo.details.trim()}`);
  return parts.join('; ');
}

/** Текст сообщения с фото в истории для модели. */
export function withPhotoNote(text: string, note: string | null): string {
  if (!note) return text;
  const caption = String(text ?? '').trim();
  const label = `[Ты отправил(а) фото из своей галереи: ${note}]`;
  return caption && caption !== '[фото]' ? `${label}\n${caption}` : label;
}

export interface SendRecord {
  photoId: number;
  sentAt: number;
  date: string;
}

export interface PhotoAvailability {
  /** Автоотправка разрешена образом и аккаунтом — фото-просьбы бот ведёт сам. */
  enabled: boolean;
  available: boolean;
  reason: string;
  mode: SendMode;
  sent_today: number;
  max_per_day: number;
  candidates: Array<{
    id: string;
    description: string;
    place: string;
    taken: string;
    freshness: Freshness;
    details: string;
    tags: string[];
  }>;
  shown_before: Array<{ id: string; description: string; when: string }>;
}

export const MAX_CANDIDATES = 60;

/**
 * Решает, может ли бот прямо сейчас отправить фото, и какие снимки ему
 * разрешены. Это потолок, а не план: выбирать или нет — решает модель.
 */
export function photoAvailability(input: {
  rules: PhotoSetRules;
  accountAutoSend: boolean;
  photos: Array<PhotoFacts & { autoSend: boolean }>;
  sends: SendRecord[];
  now: number;
  today: string;
}): PhotoAvailability {
  const { rules, photos, sends, now, today } = input;
  const mode: SendMode =
    rules.sendMode === 'request' ? 'request' : 'initiative';
  const sentToday = sends.filter((s) => s.date === today).length;
  const last = Math.max(0, ...sends.map((s) => s.sentAt));
  const shownIds = new Set(sends.map((s) => s.photoId));
  const byId = new Map(photos.map((p) => [p.id, p]));
  const base = {
    enabled: rules.autoSend && input.accountAutoSend,
    mode,
    sent_today: sentToday,
    max_per_day: rules.maxPerDay,
    shown_before: [...shownIds]
      .map((id) => byId.get(id))
      .filter((p): p is NonNullable<typeof p> => Boolean(p))
      .slice(-20)
      .map((p) => ({
        id: String(p.id),
        description: p.description,
        when: formatTakenOn(p.takenOn),
      })),
  };
  const blocked = (reason: string): PhotoAvailability => ({
    ...base,
    available: false,
    reason,
    candidates: [],
  });
  if (!rules.autoSend) return blocked('автоотправка в образе выключена');
  if (!input.accountAutoSend)
    return blocked('автоотправка выключена для этого аккаунта');
  if (rules.maxPerDay <= 0) return blocked('лимит в день равен нулю');
  if (sentToday >= rules.maxPerDay)
    return blocked('дневной лимит фото исчерпан');
  if (last && now - last < rules.minIntervalMin * 60)
    return blocked('с прошлого фото прошло слишком мало времени');
  const candidates = photos
    .filter((p) => p.autoSend && !(rules.noRepeat && shownIds.has(p.id)))
    .slice(0, MAX_CANDIDATES)
    .map((p) => ({
      id: String(p.id),
      description: p.description,
      place: p.place ?? '',
      taken: formatTakenOn(p.takenOn),
      freshness: photoFreshness(p.takenOn, today),
      details: p.details,
      tags: p.tags,
    }));
  if (!candidates.length) return blocked('новых снимков для автоотправки нет');
  return { ...base, available: true, reason: '', candidates };
}

/**
 * Выбор судьи проверяется кодом: только снимок из списка кандидатов, и в
 * режиме «по просьбе» — только когда человек действительно попросил фото.
 */
export function acceptPhotoChoice(
  availability: PhotoAvailability | undefined,
  choice: { photo_id: string; reason: string } | undefined,
  photoRequested: boolean,
): string | null {
  if (!availability?.available || !choice?.photo_id || !choice.reason.trim())
    return null;
  if (availability.mode === 'request' && !photoRequested) return null;
  return availability.candidates.some((c) => c.id === choice.photo_id)
    ? choice.photo_id
    : null;
}

/** Подпись Telegram к фото — до 1024 знаков. */
export const CAPTION_LIMIT = 1024;

/** Дата съёмки из EXIF (DateTimeOriginal), если она там есть и правдоподобна. */
export function exifDate(exif: Buffer | undefined | null): string | null {
  if (!exif?.length) return null;
  const text = exif.toString('latin1');
  const m = /(\d{4}):(\d{2}):(\d{2}) \d{2}:\d{2}:\d{2}/.exec(text);
  if (!m) return null;
  return normalizeTakenOn(`${m[1]}-${m[2]}-${m[3]}`);
}

/** Строка ответа, которую модель отметила подписью к фото. */
export const CAPTION_MARK = '[ФОТО]';
const MARK_RX = /^\s*\[\s*фото\s*\]\s*:?\s*/iu;
/** Если маркер потерялся — строка, которая явно говорит о снимке. */
const PHOTO_LINE_RX =
  /(?:^|[\s,.!?«"(])(?:вот|смотри|глянь|зацени|это\s+(?:я|мой|моя|мои|мы)|на\s+фото|фот\S*|сним\S*|кадр\S*|селфи)(?=$|[\s,.!?»")])/iu;

export interface PhotoCaptionSplit {
  before: string;
  caption: string;
  after: string;
}

/**
 * Делит ответ на текст до фото, подпись и текст после. Фото уходит на месте
 * подписи, а не всегда первым: «ответ на вопрос» → «фото: вот я в зале».
 * Нет ни маркера, ни строки о снимке — фото уходит последним без подписи.
 */
export function splitPhotoCaption(reply: string): PhotoCaptionSplit {
  const lines = String(reply ?? '')
    .replace(/\r\n?/g, '\n')
    .split('\n');
  let at = lines.findIndex((line) => MARK_RX.test(line));
  if (at < 0) at = lines.findIndex((line) => PHOTO_LINE_RX.test(line));
  const clean = (list: string[]) =>
    list
      .map((line) => line.replace(MARK_RX, ''))
      .join('\n')
      .trim();
  if (at < 0) return { before: clean(lines), caption: '', after: '' };
  return {
    before: clean(lines.slice(0, at)),
    caption: clean([lines[at]]),
    after: clean(lines.slice(at + 1)),
  };
}
