import { useEffect } from 'react';
import { Bot, ChevronDown, Paperclip, UserRound } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { AVATAR_BG } from '../../utils/avatar';
import ClientAvatar, { ACTIVITY_LABEL } from '../../components/ClientAvatar/ClientAvatar';
import VoicePlayer from '../../components/VoicePlayer/VoicePlayer';
import {
  authorClass,
  mediaKind,
  mediaUrl,
  telegramReadMark,
  withToken,
} from '../../utils/chat';
import { markListened as markListenedApi } from '../../api/conversations';
import EmojiPicker, { PICKER_W, PICKER_H } from '../../components/composer/EmojiPicker';
import { REACTION_EMOJI } from '../../utils/reactions';

const JUMP_SHOW_PX = 400;

// Рамка под фото/видео занимает место ещё до загрузки файла: поздно пришедшая
// картинка не толкает ленту. Сам файл вписывается в рамку целиком.
const MEDIA_BOX = 'block aspect-square w-[260px] max-w-full shrink-0 overflow-hidden rounded-lg bg-muted';
const NOTE_BOX = 'block aspect-square w-[240px] max-w-full shrink-0 overflow-hidden rounded-full bg-muted';
const MEDIA_ITEM = 'mediaItem block size-full object-contain';
const NOTE_ITEM = 'mediaItem videoNote block size-full object-cover';

// Колонка сообщений стоит по центру ленты и не шире max-w-3xl: на широком экране
// собеседник и бот не разъезжаются по краям. Пузырь — не шире 70% колонки.
// Подряд идущие сообщения одного автора — одна группа: между пузырями группы
// 2px (GROUP_NEXT), между группами 12px (GROUP_FIRST). Обёрток у групп нет —
// строки остаются прямыми детьми ленты: от этого зависят прокрутка и «прочитано».
const ROW = 'msgRow group mx-auto flex w-full max-w-3xl shrink-0 items-end gap-2';
const GROUP_FIRST = 'mt-3';
const GROUP_NEXT = 'mt-0.5';
const INNER = 'flex min-w-0 flex-1 items-end gap-2';
const CONTENT = 'flex max-w-[85%] min-w-0 flex-col gap-0.5 sm:max-w-[70%]';
const AVATAR = 'clientAvatar size-8 shrink-0 rounded-full border text-[10px]';
// Аватар стоит только у последнего сообщения группы; у остальных — пустое место той же ширины.
const AVATAR_GAP = 'size-8 shrink-0';
const BUBBLE = 'flex max-w-full min-w-0 flex-col gap-1.5 rounded-2xl border px-3 py-1.5 text-sm leading-5 [overflow-wrap:anywhere]';
// Пузыри нейтральные: собеседник — серая подложка, наши (бот и менеджер) —
// карточка с рамкой. Кто именно писал, говорит подпись над первым пузырём группы.
const BUBBLE_KIND = {
  client: 'border-transparent bg-muted',
  bot: 'bg-card',
  manager: 'bg-card',
};
const TAG = 'flex h-4 items-center gap-1 px-1 text-[11px] leading-4 text-muted-foreground [&_svg]:size-3';
// Строка под пузырём — 16px: галочки и время видны всегда.
const META = 'msgMeta flex h-4 items-center gap-1.5 px-1 text-[11px] leading-4 whitespace-nowrap';
// Действия («Ответить», «Изменить», «Реакция») проявляются при наведении на
// строку сообщения или фокусе внутри неё; на экранах без наведения видны всегда.
// Из DOM и из обхода клавиатурой они не уходят.
const ACTIONS =
  'msgActions inline-flex items-center opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 [@media(hover:none)]:opacity-100';
const ROW_TOOL = 'h-4 rounded-sm px-1 text-[11px] font-normal text-muted-foreground';
const TG_MARK = 'pr-0.5 tracking-tighter';
const DOT = 'size-1.5 rounded-full bg-muted-foreground animate-[typingDot_1.2s_ease-in-out_infinite]';

function fmtTime(ts) {
  if (!ts) return '';
  return new Date(ts * 1000).toLocaleTimeString('ru-RU', { timeZone: 'Europe/Moscow', hour: '2-digit', minute: '2-digit' });
}

const listened = new Set();
function markListened(chatId, msg) {
  if (msg.role !== 'user' || listened.has(msg.id)) return;
  listened.add(msg.id);
  markListenedApi(chatId, msg.id).catch(() => {
    listened.delete(msg.id);
  });
}

function MediaContent({ chatId, msg, inbound = null }) {
  if (msg.media_kind && msg.media_url) {
    const raw = String(msg.content || '');
    const caption = raw.startsWith('[') ? raw.split('\n').slice(1).join('\n').trim() : raw;
    const label = caption ? <p>{caption}</p> : null;
    const src = withToken(msg.media_url);
    if (msg.media_kind === 'photo' || msg.media_kind === 'sticker') {
      return <>
        <a className={MEDIA_BOX} href={src} target="_blank" rel="noreferrer"><img className={MEDIA_ITEM} src={src} alt={caption || 'Вложение'} loading="lazy" /></a>
        {label}
      </>;
    }
    if (msg.media_kind === 'video_note') {
      return <>
        <span className={NOTE_BOX}><video className={NOTE_ITEM} src={src} controls playsInline preload="metadata" /></span>
        {label}
      </>;
    }
    if (msg.media_kind === 'animation' || msg.media_kind === 'video') {
      const gif = msg.media_kind === 'animation';
      return <>
        <span className={MEDIA_BOX}><video className={MEDIA_ITEM} src={src} controls={!gif} autoPlay={gif} loop={gif} muted={gif} playsInline preload="metadata" /></span>
        {label}
      </>;
    }
    if (msg.media_kind === 'voice') {
      return <>
        <VoicePlayer src={withToken(msg.media_url)} onListened={() => markListened(chatId, msg)} />
        {label}
      </>;
    }
    const named = /^\[[^:\]]+:\s*([^\]]+)\]/.exec(raw)?.[1]?.trim();
    return (
      <>
        <a className="inline-flex items-center gap-2 font-medium text-primary underline-offset-4 hover:underline" href={src} target="_blank" rel="noreferrer" download={named || undefined}>
          <Paperclip className="size-4 shrink-0" aria-hidden="true" />
          {named || caption || 'Файл'}
        </a>
        {named && caption ? <p>{caption}</p> : label}
      </>
    );
  }
  const kind = mediaKind(msg.content);
  const src = mediaUrl(chatId, msg.ts);
  const text = String(msg.content || '');
  if (!kind && inbound && text.startsWith('[')) {
    const k = inbound.kind;
    const caption = text.split('\n').slice(1).join('\n').trim();
    const label = caption ? <p>{caption}</p> : null;
    let body = null;
    if (k === 'photo') body = <span className={MEDIA_BOX}><img className={MEDIA_ITEM} src={src} alt="Фото клиента" /></span>;
    else if (k === 'video_note') body = <span className={NOTE_BOX}><video className={NOTE_ITEM} src={src} controls playsInline preload="metadata" /></span>;
    else if (k === 'video') body = <span className={MEDIA_BOX}><video className={MEDIA_ITEM} src={src} controls playsInline preload="metadata" /></span>;
    else if (k === 'animation') body = <span className={MEDIA_BOX}><video className={MEDIA_ITEM} src={src} autoPlay loop muted playsInline preload="metadata" /></span>;
    else if (k === 'voice' || k === 'audio' || k === 'audio_note') body = <VoicePlayer src={src} />;
    if (body) return <>{body}{label}</>;
  }
  if (!kind) {
    return text.split('\n\n').map((para, j) => <p key={j}>{para}</p>);
  }
  if (kind === 'photo') {
    return <span className={MEDIA_BOX}><img className={MEDIA_ITEM} src={src} alt="Фото" /></span>;
  }
  if (kind === 'video' || kind === 'video_note') {
    return <span className={MEDIA_BOX}><video className={MEDIA_ITEM} src={src} controls preload="metadata" /></span>;
  }
  if (kind === 'audio' || kind === 'voice' || kind === 'audio_note') {
    return <VoicePlayer src={src} />;
  }
  return <p>{msg.content}</p>;
}

export function pickerPlacement(rect, viewport = { width: window.innerWidth, height: window.innerHeight }) {
  const PANEL_W = PICKER_W;
  const PANEL_H = PICKER_H;
  const left = Math.max(8, Math.min(rect.left, viewport.width - PANEL_W - 8));
  return rect.top > PANEL_H + 16
    ? { left, bottom: viewport.height - rect.top + 6 }
    : { left, top: Math.min(rect.bottom + 6, viewport.height - PANEL_H - 8) };
}

export function canEdit(msg, kind) {
  if (!msg?.id || !msg.tg_msg_id || msg.deleted_at || msg.media_kind) return false;
  if (kind === 'client' || msg.role === 'user') return false;
  const text = String(msg.content || '');
  return Boolean(text.trim()) && !/^\[(media:|Реакция|фото|видео|гиф|голосовое|кружок|файл)/i.test(text);
}

function MessageFeed({
  id,
  data,
  name,
  messages,
  messagesRef,
  atBottomRef,
  rowRefs,
  readUpTo,
  highlight,
  hits,
  stickyDate,
  jump,
  setJump,
  editing,
  setEditing,
  saveEdit,
  busy,
  findInboundMedia,
  setReply,
  reactFor,
  setReactFor,
  react,
}) {
  // Блок ввода растёт (поле, полоса ответа, вложения) — лента становится ниже.
  // Если она стояла у последних сообщений, оставляем её там же.
  useEffect(() => {
    const el = messagesRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(() => {
      if (atBottomRef.current) el.scrollTop = el.scrollHeight;
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [messagesRef, atBottomRef]);

  const kinds = messages.map(authorClass);
  const typing = Boolean(data.client_typing);

  return (
    <div
      className="messages relative flex min-h-0 flex-1 flex-col overflow-y-auto bg-background px-4 pt-9 pb-3 [scrollbar-gutter:stable] md:px-6"
      ref={messagesRef}
      onScroll={(e) => {
        const el = e.currentTarget;
        atBottomRef.current =
          el.scrollHeight - el.scrollTop - el.clientHeight < 40;
        const far = el.scrollHeight - el.scrollTop - el.clientHeight > JUMP_SHOW_PX;
        setJump((j) => (far === j.show && (far || !j.unseen) ? j : { show: far, unseen: far ? j.unseen : 0 }));
        if (reactFor) setReactFor(null);
      }}
    >
      {/* Нулевая высота (отступы гасят друг друга): дата висит поверх ленты и
          не сдвигает сообщения, когда появляется или меняется. Это тихая
          подпись без рамки; полупрозрачный фон нужен только для читаемости
          поверх пузырей. */}
      {stickyDate && (
        <div className="dateSticky pointer-events-none sticky top-2 z-[6] -mt-7 mb-7 flex h-0 shrink-0 justify-center" aria-hidden="true">
          <span className="inline-flex h-5 items-center rounded-sm bg-background/85 px-2 text-[11px] whitespace-nowrap text-muted-foreground">
            {stickyDate}
          </span>
        </div>
      )}
      {messages.map((msg, i) => {
        const kind = kinds[i];
        const ours = kind !== 'client';
        const groupFirst = kinds[i - 1] !== kind;
        // «Печатает» продолжает группу собеседника: аватар тогда стоит у той строки.
        const groupLast = kinds[i + 1] !== kind && !(typing && !ours && i === messages.length - 1);
        const isRead = i <= readUpTo;
        const tgMark = telegramReadMark(msg, kind);
        const actions = msg.tg_msg_id && (
          <span className={cn(ACTIONS, reactFor?.id === msg.tg_msg_id && 'opacity-100')}>
            <Button
              type="button"
              variant="ghost"
              size="xs"
              className={ROW_TOOL}
              onClick={() => setReply({ tg_msg_id: msg.tg_msg_id, text: String(msg.content || '') })}
            >
              Ответить
            </Button>
            {canEdit(msg, kind) && (
              <Button
                type="button"
                variant="ghost"
                size="xs"
                className={ROW_TOOL}
                data-testid="edit-message"
                onClick={() => setEditing({ id: msg.id, text: String(msg.content || '') })}
              >
                Изменить
              </Button>
            )}
            {!ours && (
              <span className="relative inline-flex">
                <Button
                  type="button"
                  variant="ghost"
                  size="xs"
                  className={ROW_TOOL}
                  onClick={(e) => setReactFor({ id: msg.tg_msg_id, at: pickerPlacement(e.currentTarget.getBoundingClientRect()) })}
                >
                  {msg.reaction || 'Реакция'}
                </Button>
                {reactFor?.id === msg.tg_msg_id && (
                  <EmojiPicker
                    only={REACTION_EMOJI}
                    title="Реакция"
                    className="fixed bottom-auto left-auto mb-0"
                    style={reactFor.at}
                    onPick={(emoji) => react(msg, emoji)}
                    onClose={() => setReactFor(null)}
                  />
                )}
              </span>
            )}
          </span>
        );
        return (
          <div
            key={`${msg.ts}-${i}`}
            data-idx={i}
            ref={(el) => { rowRefs.current[i] = el; }}
            className={cn(
              ROW,
              groupFirst ? GROUP_FIRST : GROUP_NEXT,
              ours ? 'msgAI' : 'msgClient',
              highlight === i && 'animate-[msgFlash_2.4s_ease-out] rounded-md',
            )}
          >
            <div className={cn(INNER, ours ? 'justify-end' : 'justify-start')}>
              {!ours &&
                (groupLast ? (
                  <ClientAvatar className={AVATAR} style={{ '--av-bg': AVATAR_BG.blue }} src={data.client_avatar} name={name} />
                ) : (
                  <span className={AVATAR_GAP} aria-hidden="true" />
                ))}
              <div className={cn(CONTENT, ours ? 'items-end' : 'items-start')}>
                {ours && groupFirst &&
                  (kind === 'manager' ? (
                    <span className={cn('tagManaged', TAG)}><UserRound aria-hidden="true" /> Менеджер</span>
                  ) : (
                    <span className={cn('tagAI', TAG)}><Bot aria-hidden="true" /> Бот</span>
                  ))}
                <div
                  className={cn(
                    BUBBLE,
                    BUBBLE_KIND[kind],
                    !ours && !isRead && 'border-foreground/30',
                    hits.includes(i) && 'ring-1 ring-warning-foreground/50',
                    msg.deleted_at && 'line-through opacity-50',
                  )}
                >
                  {msg.reply_to && (
                    <span className="block truncate rounded-r-md border-l-2 border-border bg-background/50 px-2 py-1 text-xs text-muted-foreground">
                      {(messages.find((x) => x.tg_msg_id === msg.reply_to)?.content ?? 'сообщение').slice(0, 120)}
                    </span>
                  )}
                  {editing && editing.id === msg.id ? (
                    <div className="flex min-w-[min(360px,70vw)] flex-col gap-1.5" data-testid="edit-box">
                      <Textarea
                        className="min-h-16 resize-y bg-background field-sizing-fixed [field-sizing:fixed] dark:bg-background"
                        value={editing.text}
                        autoFocus
                        rows={Math.min(8, Math.max(2, editing.text.split('\n').length))}
                        onChange={(e) => setEditing({ ...editing, text: e.target.value })}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && !e.shiftKey) {
                            e.preventDefault();
                            saveEdit();
                          }
                          if (e.key === 'Escape') setEditing(null);
                        }}
                      />
                      <div className="flex flex-wrap items-center justify-end gap-1.5">
                        <span className="min-w-[140px] flex-1 text-xs text-muted-foreground">Enter — сохранить, Esc — отмена. Изменится и у собеседника.</span>
                        <Button type="button" variant="ghost" size="xs" onClick={() => setEditing(null)}>Отмена</Button>
                        <Button type="button" size="xs" disabled={busy || !editing.text.trim()} onClick={saveEdit}>
                          Сохранить
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <MediaContent chatId={id} msg={msg} inbound={findInboundMedia(msg)} />
                  )}
                  {msg.reaction && (
                    <span className="inline-flex w-fit items-center gap-1 rounded-full bg-background/60 px-2 text-sm">{msg.reaction}</span>
                  )}
                </div>
                {/* Всегда одна строка 16px: она не меняет рост, когда у сообщения
                    появляется tg id и вместе с ним действия. У наших сообщений
                    действия стоят слева от времени — время остаётся у края пузыря. */}
                <span className={META}>
                  {ours && actions}
                  {tgMark && (
                    <span
                      className={cn(
                        'leading-none',
                        tgMark.read && cn(TG_MARK, 'text-primary'),
                        !tgMark.read && !ours && 'text-[8px] text-primary',
                        !tgMark.read && ours && cn(TG_MARK, 'text-muted-foreground'),
                      )}
                      title={tgMark.title}
                      data-testid="tg-read"
                    >
                      {tgMark.icon}
                    </span>
                  )}
                  <span className="tabular-nums text-muted-foreground">{fmtTime(msg.ts)}</span>
                  {msg.deleted_at && (
                    <span className="text-destructive" title="Собеседник удалил сообщение — бот его не читает">
                      удалено
                    </span>
                  )}
                  {msg.edited_at && !msg.deleted_at && (
                    <span className="text-muted-foreground italic" title={`Изменено ${fmtTime(msg.edited_at)}`}>изменено</span>
                  )}
                  {!ours && actions}
                </span>
              </div>
            </div>
          </div>
        );
      })}
      {typing && (
        <div
          className={cn(ROW, kinds.at(-1) === 'client' ? GROUP_NEXT : GROUP_FIRST, 'msgClient')}
          data-testid="client-typing"
        >
          <div className={cn(INNER, 'justify-start')}>
            <ClientAvatar className={AVATAR} style={{ '--av-bg': AVATAR_BG.blue }} src={data.client_avatar} name={name} />
            <div className={cn(CONTENT, 'items-start')}>
              <div className={cn(BUBBLE, BUBBLE_KIND.client, 'flex-row items-center')}>
                <span className="text-xs text-muted-foreground">{ACTIVITY_LABEL[data.client_typing] ?? 'печатает'}</span>
                <span className="inline-flex gap-1" aria-hidden="true">
                  <i className={DOT} />
                  <i className={cn(DOT, '[animation-delay:0.15s]')} />
                  <i className={cn(DOT, '[animation-delay:0.3s]')} />
                </span>
              </div>
            </div>
          </div>
        </div>
      )}
      {/* Обёртка нулевой высоты: кнопка появляется поверх ленты и её не двигает. */}
      {jump.show && (
        <div className="pointer-events-none sticky bottom-2 z-[3] flex h-0 shrink-0 justify-end">
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="pointer-events-auto relative size-9 -translate-y-full rounded-full bg-card hover:bg-accent dark:bg-card dark:hover:bg-accent"
            data-testid="jump-down"
            aria-label="К последним сообщениям"
            title="К последним сообщениям"
            onClick={() => {
              const el = messagesRef.current;
              if (!el) return;
              atBottomRef.current = true;
              el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
              setJump({ show: false, unseen: 0 });
            }}
          >
            <ChevronDown aria-hidden="true" />
            {jump.unseen > 0 && (
              <Badge className="absolute -top-1.5 -right-1 h-5 min-w-5 rounded-full px-1 tabular-nums">
                {jump.unseen > 99 ? '99+' : jump.unseen}
              </Badge>
            )}
          </Button>
        </div>
      )}
    </div>
  );
}

export default MessageFeed;
