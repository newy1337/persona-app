export const OUTGOING_KINDS = [
  'text',
  'photo',
  'video',
  'animation',
  'voice',
  'video_note',
  'document',
  'sticker',
  'reaction',
] as const;
export type OutgoingKind = (typeof OUTGOING_KINDS)[number];

export const isOutgoingKind = (v: unknown): v is OutgoingKind =>
  typeof v === 'string' && (OUTGOING_KINDS as readonly string[]).includes(v);

export const KIND_LABEL: Record<string, string> = {
  photo: '[фото]',
  video: '[видео]',
  animation: '[гиф]',
  voice: '[голосовое]',
  video_note: '[кружок]',
  document: '[файл]',
  sticker: '[стикер]',
};

const BY_EXTENSION: Record<string, OutgoingKind> = {
  jpg: 'photo',
  jpeg: 'photo',
  png: 'photo',
  webp: 'photo',
  heic: 'photo',
  gif: 'animation',
  mp4: 'video',
  mov: 'video',
  webm: 'video',
  mkv: 'video',
  ogg: 'voice',
  oga: 'voice',
  opus: 'voice',
  m4a: 'voice',
  mp3: 'voice',
  wav: 'voice',
};

export function kindForFile(name: string, mime = ''): OutgoingKind {
  const ext = name.toLowerCase().split('.').pop() ?? '';
  if (mime.startsWith('image/gif')) return 'animation';
  if (mime.startsWith('image/')) return 'photo';
  if (mime.startsWith('video/')) return 'video';
  if (mime.startsWith('audio/')) return 'voice';
  return BY_EXTENSION[ext] ?? 'document';
}

export const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;

export function safeFileName(name: string): string {
  const clean = String(name ?? '')
    .replace(/[^\p{L}\p{N}._-]+/gu, '_')
    .replace(/^[._-]+/, '')
    .slice(-80);
  return clean || 'file';
}

export const REACTION_EMOJI: readonly string[] = [
  '👍',
  '👎',
  '❤',
  '🔥',
  '🥰',
  '👏',
  '😁',
  '🤔',
  '🤯',
  '😱',
  '🤬',
  '😢',
  '🎉',
  '🤩',
  '🤮',
  '💩',
  '🙏',
  '👌',
  '🕊',
  '🤡',
  '🥱',
  '🥴',
  '😍',
  '🐳',
  '❤‍🔥',
  '🌚',
  '🌭',
  '💯',
  '🤣',
  '⚡',
  '🍌',
  '🏆',
  '💔',
  '🤨',
  '😐',
  '🍓',
  '🍾',
  '💋',
  '🖕',
  '😈',
  '😴',
  '😭',
  '🤓',
  '👻',
  '👨‍💻',
  '👀',
  '🎃',
  '🙈',
  '😇',
  '😨',
  '🤝',
  '✍',
  '🤗',
  '🫡',
  '🎅',
  '🎄',
  '☃',
  '💅',
  '🤪',
  '🗿',
  '🆒',
  '💘',
  '🙉',
  '🦄',
  '😘',
  '💊',
  '🙊',
  '😎',
  '👾',
  '🤷‍♂',
  '🤷',
  '🤷‍♀',
  '😡',
];

export const plainEmoji = (s: string): string => s.replace(/\uFE0F/g, '');

const REACTION_SET = new Set(REACTION_EMOJI.map(plainEmoji));

export const isReactionEmoji = (s: string): boolean =>
  REACTION_SET.has(plainEmoji(s));
