import { Suspense, lazy } from 'react';
import { X } from 'lucide-react';
import ClientAvatar from '../ClientAvatar/ClientAvatar';
import { useChatWatch } from './chatWatch';

// Само окно (с лентой и медиа чата) грузится, только когда что-то открыли.
const WatchWindow = lazy(() => import('./WatchWindow'));

/** Открытые окна наблюдения и полка свёрнутых внизу экрана. */
export default function ChatWatchLayer() {
  const watch = useChatWatch();
  if (!watch || watch.windows.length === 0) return null;
  const { windows, update, restore, focus, close } = watch;
  const shown = windows.filter((w) => !w.minimized);
  const folded = windows.filter((w) => w.minimized);
  // Порядок наложения: 41…46 — над шапкой (z-40), под меню и диалогами (z-50).
  const layer = new Map([...shown].sort((a, b) => (a.z ?? 0) - (b.z ?? 0)).map((w, i) => [w.chatId, 41 + i]));

  return (
    <>
      <Suspense fallback={null}>
        {shown.map((w) => (
          <WatchWindow key={w.chatId} win={w} zIndex={layer.get(w.chatId)} onUpdate={update} onFocus={focus} onClose={close} />
        ))}
      </Suspense>
      {folded.length > 0 && (
        <div
          data-testid="watch-dock"
          className="fixed bottom-3 left-1/2 z-40 flex max-w-[calc(100vw-24px)] -translate-x-1/2 gap-1.5 overflow-x-auto rounded-full border bg-card p-1 shadow-lg"
        >
          {folded.map((w) => {
            const name = w.name || `Чат ${w.chatId}`;
            return (
              <span key={w.chatId} className="flex shrink-0 items-center rounded-full bg-muted/60">
                <button
                  type="button"
                  className="flex h-8 items-center gap-1.5 rounded-full pr-1 pl-1 text-xs hover:bg-muted"
                  title={`Развернуть: ${name}`}
                  onClick={() => restore(w.chatId)}
                >
                  <ClientAvatar
                    className="size-6 rounded-full bg-muted text-[9px] font-medium text-muted-foreground"
                    style={{ '--av-bg': 'var(--muted)' }}
                    src={w.avatar}
                    name={name}
                  />
                  <span className="max-w-28 truncate">{name}</span>
                </button>
                <button
                  type="button"
                  aria-label={`Закрыть: ${name}`}
                  className="mr-1 flex size-6 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground [&_svg]:size-3.5"
                  onClick={() => close(w.chatId)}
                >
                  <X aria-hidden="true" />
                </button>
              </span>
            );
          })}
        </div>
      )}
    </>
  );
}
