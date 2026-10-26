import { Fragment, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ArrowUpRight, Bot, Minus, UserRound, X } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { Skeleton } from '@/components/ui/skeleton';
import { IconAction } from '../IconAction/IconAction';
import ClientAvatar from '../ClientAvatar/ClientAvatar';
import { MediaContent, fmtTime } from '../../pages/ConversationPage/MessageFeed';
import { getConversationById, getConversationRevision } from '../../api/conversations';
import { authorClass, fmtChatDate } from '../../utils/chat';
import { WATCH_H, WATCH_W, clampWatch } from './chatWatch';

// Окно — «телефон»: шапка с собеседником, лента только для чтения и строка о
// том, кто ведёт. Ответить, изменить, поставить на паузу — в самом чате
// (кнопка ↗). Пока окно открыто, оно раз в 3 секунды спрашивает ревизию
// диалога и перечитывает переписку, только если она изменилась.
const POLL_MS = 3000;
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

  return { data, error };
}

function Feed({ chatId, messages }) {
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
            <div className={cn(BUBBLE, BUBBLE_KIND[kind], msg.deleted_at && 'line-through opacity-50')}>
              {/* Медиа в окне ужимается под ширину «телефона». */}
              <div className="flex min-w-0 flex-col gap-1 [&_.block]:max-w-full [&_.aspect-square]:w-[220px]">
                <MediaContent chatId={chatId} msg={msg} />
              </div>
              <span className="flex items-center gap-1 self-end text-[10px] leading-3 text-muted-foreground tabular-nums">
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

export default function WatchWindow({ win, zIndex, onUpdate, onFocus, onClose }) {
  const navigate = useNavigate();
  const { data, error } = useWatchedChat(win.chatId, win.minimized);
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
        <Feed chatId={win.chatId} messages={data.messages ?? []} />
      ) : error ? (
        <p className="m-auto px-6 text-center text-xs text-destructive">Не удалось загрузить диалог</p>
      ) : (
        <div className="flex flex-1 flex-col gap-2 p-3" role="status" aria-busy="true">
          <Skeleton className="h-8 w-40 rounded-2xl" />
          <Skeleton className="h-8 w-32 self-end rounded-2xl" />
          <Skeleton className="h-12 w-48 rounded-2xl" />
        </div>
      )}

      {data && (
        <footer className="flex h-8 shrink-0 items-center justify-center gap-1.5 border-t text-[11px] text-muted-foreground [&_svg]:size-3">
          {data.is_paused ? <UserRound aria-hidden="true" /> : <Bot aria-hidden="true" />}
          {data.is_paused ? 'Ведёт менеджер' : 'Ведёт бот'}
        </footer>
      )}
    </section>
  );
}
