import { cn } from '@/lib/utils';
import { Skeleton } from '@/components/ui/skeleton';

/**
 * Воронка-фильтр над списком: сегменты «этап → число» в одной рамке.
 * Клик по сегменту выбирает этап; полоска снизу — доля этапа от total.
 * Число ещё не пришло (count == null) — на его месте Skeleton той же высоты.
 *
 *   items: [{ key, label, count, hint? }]   key '' — «Все»
 *   value: выбранный key;  onChange(key)
 */
export function StageTabs({ items, value, onChange, total, className, 'aria-label': ariaLabel = 'Этапы' }) {
  return (
    <div
      role="group"
      aria-label={ariaLabel}
      className={cn(
        'grid auto-cols-[minmax(104px,1fr)] grid-flow-col divide-x overflow-x-auto rounded-lg border bg-card [scrollbar-width:none] [&::-webkit-scrollbar]:hidden',
        className,
      )}
    >
      {items.map((item) => {
        const active = value === item.key;
        const share = total > 0 && item.count != null ? Math.min(1, item.count / total) : 0;
        return (
          <button
            key={item.key || 'all'}
            type="button"
            aria-pressed={active}
            title={item.hint}
            className={cn(
              'relative flex min-w-0 flex-col gap-1 px-3 pt-2 pb-3 text-left outline-none transition-colors first:rounded-l-lg last:rounded-r-lg hover:bg-accent/50 focus-visible:z-10 focus-visible:ring-[3px] focus-visible:ring-ring/50',
              active && 'bg-accent/70 hover:bg-accent/70',
            )}
            onClick={() => onChange(item.key)}
          >
            <span className={cn('truncate text-xs text-muted-foreground', active && 'text-foreground')}>{item.label}</span>
            {item.count == null ? (
              <Skeleton className="h-5 w-8" />
            ) : (
              <span className="text-sm leading-5 font-semibold tabular-nums">{item.count}</span>
            )}
            <span className="absolute inset-x-3 bottom-1.5 h-0.5 overflow-hidden rounded-full bg-border" aria-hidden="true">
              <span
                className={cn('block h-full rounded-full bg-muted-foreground/60 transition-[width]', active && 'bg-primary')}
                style={{ width: `${Math.round(share * 100)}%` }}
              />
            </span>
          </button>
        );
      })}
    </div>
  );
}
