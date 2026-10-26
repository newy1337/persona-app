import { useSyncExternalStore } from 'react';
import { TriangleAlert } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { leadTypeLabel } from './rowLayout';
import { lastSeen } from './DialogTable';

// Список диалогов на телефоне: вместо широкой таблицы — карточки. В карточке
// то, по чему решают, открыть ли чат: кто, когда, стадия, что дальше или
// почему срочно. Цвета те же, что у строк таблицы: срочные — красные с
// полоской, без этапа — жёлтые.

const NARROW = '(max-width: 639px)';
const subscribe = (cb) => {
  const list = typeof window !== 'undefined' && window.matchMedia ? window.matchMedia(NARROW) : null;
  list?.addEventListener?.('change', cb);
  return () => list?.removeEventListener?.('change', cb);
};
/**
 * Узкий экран (телефон). Без matchMedia (тесты) — широкий: таблица. Ширина
 * окна проверяется и напрямую: подменённый в тестах matchMedia отвечает «да»
 * на любой запрос.
 */
export function useNarrow() {
  return useSyncExternalStore(subscribe, () =>
    typeof window !== 'undefined' && window.matchMedia ? window.matchMedia(NARROW).matches && window.innerWidth < 640 : false,
  );
}

export function DialogCards({ rows, archived, urgent, onOpen, helpers }) {
  const { Avatar, Stage, isNew, unreadLabel, nextAction } = helpers;
  if (rows.length === 0) {
    return <p className="rounded-lg border bg-card p-6 text-center text-sm text-muted-foreground">{archived ? 'В архиве пусто' : 'Диалогов нет'}</p>;
  }
  return (
    <ul className="flex flex-col gap-2" data-testid="dialog-cards">
      {rows.map((row) => {
        const who = row.name || `Чат ${row.chat_id}`;
        const reason = urgent?.get(String(row.chat_id)) ?? null;
        const noStage = !reason && !archived && !row.hidden && !row.deal_stage;
        const fresh = isNew(row);
        const next = nextAction(row.next_bot_action, undefined, { short: true });
        const about = [row.age ? `${row.age} лет` : null, row.city].filter(Boolean).join(' · ');
        return (
          <li key={row.chat_id}>
            <button
              type="button"
              data-chat-id={row.chat_id}
              data-urgent={reason ? 'true' : undefined}
              onClick={() => onOpen(row.chat_id)}
              className={cn(
                'relative flex w-full items-start gap-3 overflow-hidden rounded-lg border bg-card p-3 text-left outline-none active:bg-muted/60 focus-visible:ring-[3px] focus-visible:ring-ring/50',
                reason && 'border-destructive/40 bg-destructive/10',
                noStage && 'bg-warning',
              )}
            >
              {reason && <span aria-hidden="true" className="absolute inset-y-0 left-0 w-1 bg-destructive" />}
              <Avatar className="size-10 shrink-0 rounded-full bg-muted text-xs font-medium text-muted-foreground" style={{ '--av-bg': 'var(--muted)' }} src={row.avatar_url} name={row.name || '—'} />
              <span className="flex min-w-0 flex-1 flex-col gap-1">
                <span className="flex items-center gap-2">
                  <span className="truncate font-medium">{who}</span>
                  {fresh && <Badge className="h-5 shrink-0 px-1.5 tabular-nums">{unreadLabel(row.unread_count)}</Badge>}
                  <span className="ml-auto shrink-0 text-xs text-muted-foreground tabular-nums">{lastSeen(row.last_message_ts).text}</span>
                </span>
                <span className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
                  {row.lead_type && <Badge variant={row.lead_type === 'cold' ? 'secondary' : 'outline'} className="h-[18px] px-1.5">{leadTypeLabel(row.lead_type)}</Badge>}
                  <Stage stage={row.stage} />
                  {about && <span className="truncate">{about}</span>}
                </span>
                {reason ? (
                  <span className="flex items-center gap-1 text-xs font-medium text-destructive">
                    <TriangleAlert className="size-3.5 shrink-0" aria-hidden="true" />
                    <span className="truncate">{reason}</span>
                  </span>
                ) : next?.text ? (
                  <span className="truncate text-xs text-muted-foreground">{row.is_paused ? 'Ведёт менеджер · ' : ''}{next.text}</span>
                ) : null}
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
