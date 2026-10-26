import { Fragment, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ArrowUpRight, Bot, CornerUpLeft, Minus, Send, UserRound, X } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { IconAction } from '../IconAction/IconAction';
import { QuickReplyPicker } from '../QuickReplyPicker/QuickReplyPicker';
import ClientAvatar from '../ClientAvatar/ClientAvatar';
import { MediaContent, fmtTime } from '../../pages/ConversationPage/MessageFeed';
import { getConversationById, getConversationRevision, sendMessage, setAiMode } from '../../api/conversations';
import { authorClass, fmtChatDate } from '../../utils/chat';
import { WATCH_H, WATCH_W, clampWatch } from './chatWatch';

// Окно — «телефон»: шапка с собеседником, лента и подвал как в чате, только
// компактный: тумблер «бот отвечает / ручной режим» и, в ручном режиме, поле
// ответа (Enter — отправить, Shift+Enter — перенос). На сообщение можно
// ответить цитатой. Вложения, голосовые, правка и реакции — в самом чате (↗).
// Пока окно открыто, оно раз в 3 секунды спрашивает ревизию диалога и
// перечитывает переписку, только если она изменилась.
const POLL_MS = 3000;
// Как на странице чата: повторный щелчок по тумблеру раньше — не в счёт.
const TOGGLE_COOLDOWN_MS = 2000;
const BUBBLE = 'flex max-w-[85%] min-w-0 flex-col gap-1 rounded-2xl border px-3 py-1.5 text-[13px] leading-5 [overflow-wrap:anywhere]';
const BUBBLE_KIND = {
  client: 'self-start border-transparent bg-muted',
  bot: 'self-end bg-card',
  manager: 'self-end bg-card',
};

/** Переписка диалога с перечитыванием по ревизии. */
function useWatchedChat(chatId, paused) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const revision = useRef(null);

  const load = useCallback(() => {
    getConversationById(chatId)
      .then((d) => {
        setData(d);
        setError(null);
      })
      .catch((e) => setError(e));
  }, [chatId]);

  useEffect(load, [load]);

  useEffect(() => {
    if (paused) return undefined;
    const tick = () => {
      if (document.visibilityState !== 'visible') return;
      getConversationRevision(chatId)
        .then((r) => {
          if (revision.current === r.revision) return;
          revision.current = r.revision;
          load();
        })
        .catch(() => {});
    };
    tick();
    const timer = setInterval(tick, POLL_MS);
    return () => clearInterval(timer);
  }, [chatId, load, paused]);

  return { data, error, reload: load };
}

function Feed({ chatId, messages, onReply }) {
  const box = useRef(null);
  const atBottom = useRef(true);
  const count = messages.length;

  // Новое сообщение прокручивает вниз, только если читали низ ленты.
  useLayoutEffect(() => {
    const el = box.current;
    if (el && atBottom.current) el.scrollTop = el.scrollHeight;
  }, [count]);

  let day = null;
  return (
    <div
      ref={box}
      data-testid="watch-feed"
      className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto px-3 py-2"
      onScroll={(e) => {
        const el = e.currentTarget;
        atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
      }}
    >
      {count === 0 && <p className="m-auto text-xs text-muted-foreground">Сообщений пока нет</p>}
      {messages.map((msg, i) => {
        const kind = authorClass(msg);
        const label = fmtChatDate(msg.ts);
        const divider = label && label !== day ? label : null;
        day = label || day;
        const Who = kind === 'manager' ? UserRound : Bot;
        return (
          <Fragment key={msg.id ?? `${msg.ts}-${i}`}>
            {divider && <p className="my-1 self-center text-[11px] text-muted-foreground">{divider}</p>}
            <div className={cn('group relative', BUBBLE, BUBBLE_KIND[kind], msg.deleted_at && 'line-through opacity-50')}>
              {msg.reply_to && (
                <p className="line-clamp-2 border-l-2 border-primary/60 pl-2 text-[11px] leading-4 text-muted-foreground">
                  {(messages.find((x) => x.tg_msg_id === msg.reply_to)?.content ?? 'сообщение').slice(0, 120)}
                </p>
              )}
              {/* Медиа в окне ужимается под ширину «телефона». */}
              <div className="flex min-w-0 flex-col gap-1 [&_.block]:max-w-full [&_.aspect-square]:w-[220px]">
                <MediaContent chatId={chatId} msg={msg} />
              </div>
              <span className="flex items-center gap-1 self-end text-[10px] leading-3 text-muted-foreground tabular-nums">
                {onReply && msg.tg_msg_id && !msg.deleted_at && (
                  <button
                    type="button"
                    className="mr-1 opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100 hover:text-foreground [@media(hover:none)]:opacity-100"
                    aria-label="Ответить"
                    title="Ответить на это сообщение"
                    onClick={() => onReply({ tg_msg_id: msg.tg_msg_id, text: String(msg.content || '') })}
                  >
                    <CornerUpLeft className="size-3" aria-hidden="true" />
                  </button>
                )}
                {kind !== 'client' && <Who className="size-3" aria-label={kind === 'manager' ? 'Менеджер' : 'Бот'} />}
                {fmtTime(msg.ts)}
              </span>
            </div>
          </Fragment>
        );
      })}
    </div>
  );
}

/** Подвал окна: тумблер режима, ошибка и — в ручном режиме — поле ответа. */
function Composer({ chatId, data, name, reload, reply, setReply }) {
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const lastToggle = useRef(0);
  const field = useRef(null);
  const aiActive = !data.is_paused;

  useEffect(() => {
    if (reply) field.current?.focus();
  }, [reply]);

  async function toggle() {
    const now = Date.now();
    if (busy || now - lastToggle.current < TOGGLE_COOLDOWN_MS) return;
    lastToggle.current = now;
    setBusy(true);
    setError(null);
    try {
      await setAiMode(chatId, !aiActive);
      reload();
    } catch (e) {
      setError(e.detail || e.message);
    } finally {
      setBusy(false);
    }
  }

  async function send() {
    const text = draft.trim();
    if (!text || busy) return;
    setBusy(true);
    setError(null);
    try {
      await sendMessage(chatId, text, { replyTo: reply?.tg_msg_id ?? null });
      setDraft('');
      setReply(null);
      reload();
    } catch (e) {
      setError(e.detail || e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <footer className="shrink-0 border-t bg-card" data-testid="watch-composer">
      <div className="flex h-9 items-center gap-2 px-3">
        <Switch checked={aiActive} onClick={toggle} disabled={busy} aria-label="Бот отвечает" />
        <span className="flex shrink-0 items-center gap-1 text-xs font-medium">
          {aiActive ? <Bot className="size-3.5" aria-hidden="true" /> : <UserRound className="size-3.5" aria-hidden="true" />}
          {aiActive ? 'бот отвечает' : 'ручной режим'}
        </span>
        {error && (
          <span role="alert" title={error} className="min-w-0 flex-1 truncate text-right text-[11px] text-destructive">
            {error}
          </span>
        )}
      </div>
      {aiActive ? (
        <p className="px-3 pb-2 text-[11px] leading-4 text-muted-foreground">Чтобы написать самим — выключите бота.</p>
      ) : (
        <div className="px-2 pb-2">
          {reply && (
            <div className="mb-1 flex items-center gap-1 rounded-md bg-muted/60 py-0.5 pr-0.5 pl-2 text-[11px]" data-testid="watch-reply">
              <span className="min-w-0 flex-1 truncate border-l-2 border-primary/60 pl-1.5 text-muted-foreground">{reply.text || 'Сообщение'}</span>
              <IconAction icon={X} label="Не отвечать на сообщение" size="icon-xs" onClick={() => setReply(null)} />
            </div>
          )}
          <div className="flex items-end gap-1 rounded-xl border bg-background focus-within:ring-2 focus-within:ring-ring/40">
            <Textarea
              ref={field}
              rows={2}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="Сообщение…"
              title="Enter — отправить, Shift+Enter — перенос строки"
              aria-label="Сообщение"
              className="max-h-24 min-h-0 flex-1 resize-none border-0 bg-transparent px-2.5 py-1.5 text-[13px] leading-5 shadow-none focus-visible:ring-0 dark:bg-transparent"
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  send();
                }
              }}
            />
            <QuickReplyPicker
              name={name}
              disabled={busy}
              onPick={(text) => {
                setDraft((d) => (d.trim() ? `${d.replace(/\s+$/, '')} ${text}` : text));
                requestAnimationFrame(() => field.current?.focus());
              }}
            />
            <IconAction icon={Send} label="Отправить" className="mr-1 mb-1" disabled={busy || !draft.trim()} onClick={send} />
          </div>
        </div>
      )}
    </footer>
  );
}

export default function WatchWindow({ win, zIndex, onUpdate, onFocus, onClose }) {
  const navigate = useNavigate();
  const { data, error, reload } = useWatchedChat(win.chatId, win.minimized);
  const [reply, setReply] = useState(null);
  const drag = useRef(null);
  const name = data?.pinned_facts?.name || win.name || `Чат ${win.chatId}`;

  const onPointerDown = (e) => {
    if (e.button !== 0 || e.target.closest('button')) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { dx: e.clientX - win.x, dy: e.clientY - win.y };
  };
  const onPointerMove = (e) => {
    if (!drag.current) return;
    onUpdate(win.chatId, clampWatch(e.clientX - drag.current.dx, e.clientY - drag.current.dy));
  };
  const onPointerUp = () => {
    drag.current = null;
  };

  return (
    <section
      role="dialog"
      aria-label={`Наблюдение: ${name}`}
      data-testid="watch-window"
      data-chat-id={win.chatId}
      className="fixed flex flex-col overflow-hidden rounded-[28px] border-4 border-muted bg-background shadow-2xl"
      style={{
        zIndex,
        left: win.x,
        top: win.y,
        width: `min(${WATCH_W}px, calc(100vw - 24px))`,
        height: `min(${WATCH_H}px, calc(100dvh - 24px))`,
      }}
      onPointerDownCapture={() => onFocus(win.chatId)}
    >
      <header
        className="flex h-12 shrink-0 cursor-grab touch-none items-center gap-2 border-b bg-card pr-1.5 pl-3 select-none active:cursor-grabbing"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        <ClientAvatar
          className="size-7 shrink-0 rounded-full bg-muted text-[10px] font-medium text-muted-foreground"
          style={{ '--av-bg': 'var(--muted)' }}
          src={win.avatar}
          name={name}
        />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm leading-4 font-medium">{name}</p>
          {win.account && <p className="truncate text-[11px] leading-3 text-muted-foreground">{win.account}</p>}
        </div>
        <IconAction icon={Minus} label="Свернуть" onClick={() => onUpdate(win.chatId, { minimized: true })} />
        <IconAction icon={ArrowUpRight} label="Открыть чат" onClick={() => navigate(`/conversation/${win.chatId}`)} />
        <IconAction icon={X} label="Закрыть" onClick={() => onClose(win.chatId)} />
      </header>

      {data ? (
        <Feed chatId={win.chatId} messages={data.messages ?? []} onReply={data.is_paused ? setReply : null} />
      ) : error ? (
        <p className="m-auto px-6 text-center text-xs text-destructive">Не удалось загрузить диалог</p>
      ) : (
        <div className="flex flex-1 flex-col gap-2 p-3" role="status" aria-busy="true">
          <Skeleton className="h-8 w-40 rounded-2xl" />
          <Skeleton className="h-8 w-32 self-end rounded-2xl" />
          <Skeleton className="h-12 w-48 rounded-2xl" />
        </div>
      )}

      {data && <Composer chatId={win.chatId} data={data} name={data?.pinned_facts?.name || win.name} reload={reload} reply={reply} setReply={setReply} />}
    </section>
  );
}
