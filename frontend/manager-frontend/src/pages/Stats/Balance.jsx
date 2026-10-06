import { cn } from '@/lib/utils';
import { Card } from '@/components/ui/card';

const money = (x) => (x === null || x === undefined ? '—' : `$${x.toFixed(2)}`);

// Литералы balanceCalm/balanceWarn/balanceAlarm остаются в className — по ним
// смотрят тесты; цвет рамки задают токены рядом.
const tone = (days) =>
  days === null || days === undefined
    ? 'border-l-border'
    : days < 1.5
      ? 'balanceAlarm border-l-destructive'
      : days < 4
        ? 'balanceWarn border-l-warning-foreground'
        : 'balanceCalm border-l-success-foreground';

export default function Balance({ data }) {
  if (!data) return null;

  if (data.error) {
    return (
      <Card className="min-h-[74px] flex-row flex-wrap items-center gap-x-4 gap-y-1 border-l-4 border-l-border px-4 py-3">
        <h3 className="text-sm font-medium">Баланс OpenRouter</h3>
        <p className="text-sm text-muted-foreground">{data.error}</p>
      </Card>
    );
  }

  return (
    <Card
      className={cn(
        'min-h-[74px] flex-row flex-wrap items-center justify-between gap-4 border-l-4 px-4 py-3',
        tone(data.days_left),
      )}
      data-testid="balance-card"
    >
      <div className="flex flex-col gap-0.5">
        <span className="text-xs text-muted-foreground">OpenRouter</span>
        <span className="text-2xl font-semibold leading-8 tabular-nums">{money(data.left)}</span>
      </div>
      <div className="flex flex-col gap-0.5 text-right text-xs text-muted-foreground max-sm:text-left [&_b]:font-medium [&_b]:text-foreground [&_b]:tabular-nums">
        <span><b>{money(data.today)}</b> сегодня</span>
        <span><b>{money(data.week)}</b> за неделю</span>
        <span><b>{money(data.month)}</b> за месяц</span>
      </div>
    </Card>
  );
}
