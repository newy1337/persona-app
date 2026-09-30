/**
 * Переписка одним HTML-файлом: открывается в любом браузере без панели и без
 * интернета — фото, видео, кружки и голосовые вшиты в файл (data: URI).
 * Здесь только разметка; файлы и данные собирает сервис.
 */

export type ExportMediaKind =
  | 'photo'
  | 'sticker'
  | 'animation'
  | 'video'
  | 'video_note'
  | 'voice'
  | 'audio'
  | 'document';

export interface ExportMedia {
  kind: ExportMediaKind;
  /** data: URI файла; null — файла нет (не скачан, удалён, слишком большой). */
  src: string | null;
  /** Внешняя ссылка (Telegram скачивал сам) — показываем ссылкой. */
  href?: string | null;
  /** Почему файла нет — подписью вместо него. */
  missing?: string | null;
  name?: string | null;
}

export interface ExportMessage {
  id: number;
  ts: number;
  role: 'user' | 'assistant' | string;
  author: string | null;
  /** Текст без метки вложения («[Голосовое сообщение]»), уже со строками. */
  text: string;
  /** Метка вложения без файла: «Кружок», «Стикер: 😂». */
  label?: string | null;
  /** Расшифровка голосового/кружка. */
  transcript?: string | null;
  media?: ExportMedia | null;
  reaction?: string | null;
  deleted?: boolean;
  /** Галочки: true — прочитано, false — доставлено, null — неизвестно. */
  read?: boolean | null;
}

export interface ExportChat {
  chatId: number;
  clientName: string;
  clientUsername: string | null;
  clientPhone: string | null;
  clientCity: string | null;
  clientAge: number | null;
  clientAvatar: string | null;
  accountName: string | null;
  accountUsername: string | null;
  accountAvatar: string | null;
  personaName: string | null;
  stage: string | null;
  exportedAt: number;
  exportedBy: string | null;
  messages: ExportMessage[];
  /** Сколько медиа не вошло целиком (лимит размера). */
  skippedMedia: number;
}

const TZ = 'Europe/Moscow';
const dayFmt = new Intl.DateTimeFormat('ru-RU', {
  timeZone: TZ,
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  weekday: 'long',
});
const timeFmt = new Intl.DateTimeFormat('ru-RU', {
  timeZone: TZ,
  hour: '2-digit',
  minute: '2-digit',
});
const fullFmt = new Intl.DateTimeFormat('ru-RU', {
  timeZone: TZ,
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});
const keyFmt = new Intl.DateTimeFormat('en-CA', { timeZone: TZ });
const dayKey = (ts: number) => keyFmt.format(new Date(ts * 1000));

export function escapeHtml(s: unknown): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Текст с переносами и кликабельными ссылками; всё прочее экранировано. */
function richText(text: string): string {
  return escapeHtml(text)
    .replace(
      /\bhttps?:\/\/[^\s<]+/g,
      (url) => `<a href="${url}" target="_blank" rel="noreferrer">${url}</a>`,
    )
    .replace(/\n/g, '<br>');
}

/** Кто написал: клиент, бот (и по какому поводу) или менеджер. */
export function authorLabel(role: string, author: string | null): string {
  if (role === 'user') return '';
  const a = author ?? 'llm';
  if (a === 'llm') return 'Бот';
  if (a === 'initiative') return 'Бот · написал первым';
  if (a === 'morning') return 'Бот · доброе утро';
  if (a === 'goodnight') return 'Бот · спокойной ночи';
  if (a === 'outreach') return 'Бот · первое сообщение';
  if (a === 'reengage') return 'Бот · возврат';
  if (a === 'operator:voice') return 'Войсер';
  if (a.startsWith('operator')) return 'Менеджер';
  return a;
}

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join('') || '?';

function avatar(src: string | null, name: string, cls: string): string {
  return src
    ? `<img class="${cls}" src="${src}" alt="">`
    : `<span class="${cls} ${cls}--empty">${escapeHtml(initials(name))}</span>`;
}

function mediaHtml(m: ExportMedia): string {
  if (!m.src) {
    if (m.href)
      return `<a class="file" href="${escapeHtml(m.href)}" target="_blank" rel="noreferrer">${escapeHtml(m.name || 'Вложение по ссылке')}</a>`;
    return `<div class="missing">${escapeHtml(m.missing || 'файл не сохранён')}</div>`;
  }
  switch (m.kind) {
    case 'photo':
      return `<a href="${m.src}" target="_blank"><img class="photo" src="${m.src}" alt="Фото" loading="lazy"></a>`;
    case 'sticker':
      return `<img class="sticker" src="${m.src}" alt="Стикер" loading="lazy">`;
    case 'animation':
      return `<video class="video" src="${m.src}" autoplay loop muted playsinline></video>`;
    case 'video_note':
      return `<video class="round" src="${m.src}" controls playsinline preload="metadata"></video>`;
    case 'video':
      return `<video class="video" src="${m.src}" controls playsinline preload="metadata"></video>`;
    case 'voice':
    case 'audio':
      return `<audio class="audio" src="${m.src}" controls preload="metadata"></audio>`;
    default:
      return `<a class="file" href="${m.src}" download="${escapeHtml(m.name || 'file')}">${escapeHtml(m.name || 'Файл')}</a>`;
  }
}

function messageHtml(m: ExportMessage): string {
  const ours = m.role !== 'user';
  const who = authorLabel(m.role, m.author);
  const ticks =
    ours && m.read != null
      ? `<span class="ticks${m.read ? ' ticks--read' : ''}" title="${m.read ? 'прочитано' : 'доставлено'}">${m.read ? '✓✓' : '✓'}</span>`
      : '';
  const parts: string[] = [];
  if (m.media) parts.push(`<div class="media">${mediaHtml(m.media)}</div>`);
  else if (m.label)
    parts.push(`<div class="label">${escapeHtml(m.label)}</div>`);
  if (m.transcript)
    parts.push(
      `<div class="transcript"><span>расшифровка</span>${richText(m.transcript)}</div>`,
    );
  if (m.text) parts.push(`<div class="text">${richText(m.text)}</div>`);
  const onlyMedia =
    m.media &&
    !m.text &&
    !m.transcript &&
    (m.media.kind === 'sticker' || m.media.kind === 'video_note');
  return `<div class="row ${ours ? 'row--out' : 'row--in'}" id="m${m.id}">
  <div class="bubble${onlyMedia ? ' bubble--bare' : ''}${m.deleted ? ' bubble--deleted' : ''}">
    ${parts.join('\n    ')}
    <div class="meta">${who ? `<span class="who">${escapeHtml(who)}</span>` : ''}${m.deleted ? '<span class="del">удалено собеседником</span>' : ''}<span class="time">${timeFmt.format(new Date(m.ts * 1000))}</span>${ticks}</div>
    ${m.reaction ? `<span class="reaction">${escapeHtml(m.reaction)}</span>` : ''}
  </div>
</div>`;
}

export function renderChatHtml(chat: ExportChat): string {
  const rows: string[] = [];
  let lastDay = '';
  for (const m of chat.messages) {
    const day = dayKey(m.ts);
    if (day !== lastDay) {
      rows.push(
        `<div class="day"><span>${escapeHtml(dayFmt.format(new Date(m.ts * 1000)))}</span></div>`,
      );
      lastDay = day;
    }
    rows.push(messageHtml(m));
  }
  const first = chat.messages[0]?.ts;
  const last = chat.messages[chat.messages.length - 1]?.ts;
  const inbound = chat.messages.filter((m) => m.role === 'user').length;
  const media = chat.messages.filter((m) => m.media?.src).length;
  const facts = [
    chat.clientAge ? `${chat.clientAge} лет` : null,
    chat.clientCity,
    chat.clientPhone,
    chat.clientUsername ? `@${chat.clientUsername}` : null,
  ].filter(Boolean) as string[];
  const title = `${chat.clientName} — переписка`;

  return `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>
:root{--bg:#eef1f6;--panel:#fff;--text:#16181d;--muted:#6b7280;--line:#e3e7ee;--in:#fff;--out:#dff3ff;--accent:#0a84ff;--read:#0a84ff;--shadow:0 1px 2px rgba(16,24,40,.08)}
@media (prefers-color-scheme:dark){:root{--bg:#0b0f17;--panel:#131a26;--text:#e7ecf3;--muted:#8a94a6;--line:#1f2937;--in:#182131;--out:#0f3552;--accent:#4cc2ff;--read:#4cc2ff;--shadow:none}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--text);font:15px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif}
.wrap{max-width:820px;margin:0 auto;padding:24px 16px 48px}
.head{background:var(--panel);border:1px solid var(--line);border-radius:18px;padding:20px;display:flex;gap:16px;align-items:center;box-shadow:var(--shadow)}
.ava{width:64px;height:64px;border-radius:50%;object-fit:cover;flex:none}
.ava--empty,.ava-sm--empty{display:inline-flex;align-items:center;justify-content:center;background:linear-gradient(135deg,#5b8cff,#8b5cf6);color:#fff;font-weight:700}
.head h1{margin:0 0 4px;font-size:22px;line-height:1.2}
.facts{color:var(--muted);font-size:14px}
.chips{display:flex;flex-wrap:wrap;gap:6px;margin-top:10px}
.chip{display:inline-flex;align-items:center;gap:6px;padding:3px 10px;border-radius:999px;border:1px solid var(--line);font-size:12px;color:var(--muted)}
.ava-sm{width:18px;height:18px;border-radius:50%;object-fit:cover;font-size:9px}
.stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:8px;margin:12px 0 8px}
.stat{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:10px 12px}
.stat b{display:block;font-size:18px}
.stat span{color:var(--muted);font-size:12px}
.day{text-align:center;margin:22px 0 10px;position:sticky;top:8px;z-index:1}
.day span{display:inline-block;padding:4px 12px;border-radius:999px;background:var(--panel);border:1px solid var(--line);color:var(--muted);font-size:12px}
.day span::first-letter{text-transform:uppercase}
.row{display:flex;margin:4px 0}
.row--out{justify-content:flex-end}
.bubble{position:relative;max-width:min(78%,520px);padding:8px 12px 6px;border-radius:16px;background:var(--in);border:1px solid var(--line);box-shadow:var(--shadow);overflow-wrap:anywhere}
.row--in .bubble{border-bottom-left-radius:6px}
.row--out .bubble{background:var(--out);border-color:transparent;border-bottom-right-radius:6px}
.bubble--bare{background:transparent!important;border-color:transparent!important;box-shadow:none;padding:0}
.bubble--deleted .text{text-decoration:line-through;opacity:.6}
.text a{color:var(--accent)}
.meta{display:flex;justify-content:flex-end;gap:6px;align-items:center;margin-top:3px;font-size:11px;color:var(--muted);white-space:nowrap}
.who{margin-right:auto;font-weight:600;padding-right:8px}
.del{color:#ef4444}
.ticks{letter-spacing:-3px;margin-right:2px}
.ticks--read{color:var(--read)}
.reaction{position:absolute;bottom:-12px;right:10px;background:var(--panel);border:1px solid var(--line);border-radius:999px;padding:0 6px;font-size:14px}
.media{margin:2px -4px 4px}
.photo,.video{display:block;max-width:100%;max-height:420px;border-radius:12px}
.round{display:block;width:240px;max-width:100%;aspect-ratio:1;object-fit:cover;border-radius:50%}
.sticker{display:block;width:160px;max-width:100%}
.audio{display:block;width:280px;max-width:100%;height:40px}
.label{color:var(--muted);font-style:italic}
.missing{color:var(--muted);font-style:italic;font-size:13px;padding:6px 8px;border:1px dashed var(--line);border-radius:10px}
.file{display:inline-block;padding:8px 12px;border-radius:10px;border:1px solid var(--line);color:var(--accent);text-decoration:none}
.transcript{margin:2px 0 4px;padding:6px 10px;border-left:3px solid var(--accent);background:rgba(127,127,127,.08);border-radius:6px;font-size:14px}
.transcript span{display:block;font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.04em}
.foot{margin-top:28px;text-align:center;color:var(--muted);font-size:12px}
@media (max-width:520px){.bubble{max-width:88%}.head{padding:14px}.ava{width:52px;height:52px}}
@media print{body{background:#fff}.day{position:static}video,audio{display:none}.bubble{box-shadow:none;break-inside:avoid}}
</style>
</head>
<body>
<div class="wrap">
  <header class="head">
    ${avatar(chat.clientAvatar, chat.clientName, 'ava')}
    <div>
      <h1>${escapeHtml(chat.clientName)}</h1>
      <div class="facts">${facts.map(escapeHtml).join(' · ') || 'чат #' + chat.chatId}</div>
      <div class="chips">
        ${chat.accountName || chat.accountUsername ? `<span class="chip">${avatar(chat.accountAvatar, chat.accountName || chat.accountUsername || '?', 'ava-sm')}Аккаунт: ${escapeHtml(chat.accountName || '')}${chat.accountUsername ? ` @${escapeHtml(chat.accountUsername)}` : ''}</span>` : ''}
        ${chat.personaName ? `<span class="chip">Личность: ${escapeHtml(chat.personaName)}</span>` : ''}
        ${chat.stage ? `<span class="chip">Этап: ${escapeHtml(chat.stage)}</span>` : ''}
        <span class="chip">Чат #${chat.chatId}</span>
      </div>
    </div>
  </header>
  <section class="stats">
    <div class="stat"><b>${chat.messages.length}</b><span>сообщений</span></div>
    <div class="stat"><b>${inbound}</b><span>от собеседника</span></div>
    <div class="stat"><b>${media}</b><span>медиа в файле</span></div>
    <div class="stat"><b>${first ? escapeHtml(fullFmt.format(new Date(first * 1000))) : '—'}</b><span>первое сообщение</span></div>
    <div class="stat"><b>${last ? escapeHtml(fullFmt.format(new Date(last * 1000))) : '—'}</b><span>последнее</span></div>
  </section>
  <main>
${rows.join('\n')}
  </main>
  <footer class="foot">
    Выгружено ${escapeHtml(fullFmt.format(new Date(chat.exportedAt * 1000)))} МСК${chat.exportedBy ? ` · ${escapeHtml(chat.exportedBy)}` : ''} · время сообщений — московское${chat.skippedMedia ? ` · ${chat.skippedMedia} медиа не вошли по размеру` : ''}
  </footer>
</div>
</body>
</html>
`;
}
