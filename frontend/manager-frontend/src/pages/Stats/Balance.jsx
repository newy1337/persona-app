import { cn } from '@/lib/utils';
import { Skeleton } from '@/components/ui/skeleton';

const money = (x) => (x === null || x === undefined ? '—' : `$${x.toFixed(2)}`);

// Одна рамка на остаток, ошибку и заглушку первой загрузки: высота строки та же.
const BOX = 'flex min-h-13 flex-wrap items-center justify-between gap-x-6 gap-y-1 rounded-lg border bg-card px-4 py-2';
const LABEL = 'text-xs text-muted-foreground';
const VALUE = 'text-lg leading-7 font-semibold tabular-nums';
const DOT = "inline-flex items-center gap-1.5 before:size-1.5 before:shrink-0 before:rounded-full before:content-['']";

// Запас по дням показывает точка перед подписью. Литералы balanceCalm /
// balanceWarn / balanceAlarm остаются в className блока — по ним смотрят тесты.
const tone = (days) =>
  days === null || days === undefined
    ? ['', 'before:bg-border']
    : days < 1.5
      ? ['balanceAlarm', 'before:bg-destructive']
      : days < 4
        ? ['balanceWarn', 'before:bg-warning-foreground']
        : ['balanceCalm', 'before:bg-success-foreground'];

export function BalanceSkeleton() {
  return (
    <div className={BOX} aria-hidden="true">
      <div className="flex items-center gap-3">
        <span className={LABEL}>OpenRouter</span>
        <span className={cn(VALUE, 'flex items-center')}><Skeleton className="h-5 w-20" /></span>
      </div>
      <Skeleton className="h-4 w-64 max-w-full" />
    </div>
  );
}

export default function Balance({ data }) {
  if (!data) return null;

  if (data.error) {
    return (
      <div className={cn(BOX, 'justify-start')}>
        <h3 className={LABEL}>Баланс OpenRouter</h3>
        <p className="text-sm text-muted-foreground">{data.error}</p>
      </div>
    );
  }

  const [mark, dot] = tone(data.days_left);

  return (
    <div className={cn(BOX, mark)} data-testid="balance-card">
      <div className="flex items-center gap-3">
        <span className={cn(LABEL, DOT, dot)}>OpenRouter</span>
        <span className={VALUE}>{money(data.left)}</span>
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-0.5 text-xs text-muted-foreground [&_b]:font-medium [&_b]:text-foreground [&_b]:tabular-nums">
        <span><b>{money(data.today)}</b> сегодня</span>
        <span><b>{money(data.week)}</b> за неделю</span>
        <span><b>{money(data.month)}</b> за месяц</span>
      </div>
    </div>
  );
}
