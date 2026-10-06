import { cn } from '@/lib/utils';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

// Форматтеры и общие классы таблиц статистики — одни на все карточки страницы.
export const money = (x) => (x >= 1 ? `$${x.toFixed(2)}` : `$${(x ?? 0).toFixed(4)}`);
export const num = (x) => (x ?? 0).toLocaleString('ru-RU');
export const kilo = (x) =>
  x >= 1e6 ? `${(x / 1e6).toFixed(1)} млн` : x >= 1e3 ? `${(x / 1e3).toFixed(1)} тыс.` : String(x ?? 0);
export const pct = (x) => `${Math.round((x ?? 0) * 100)}%`;
export const shortDay = (d) => d.slice(5).split('-').reverse().join('.');

export const TH = 'h-10 text-xs font-medium text-muted-foreground';
export const TD = 'p-3 align-top whitespace-normal [overflow-wrap:anywhere]';
export const NUM = 'text-right tabular-nums whitespace-nowrap';
// Крайние ячейки подравниваются к внутреннему отступу карточки (px-4).
export const EDGE =
  '[&_th:first-child]:pl-4 [&_td:first-child]:pl-4 [&_th:last-child]:pr-4 [&_td:last-child]:pr-4';

/**
 * Карточка раздела статистики: заголовок text-sm, необязательное описание
 * (CardDescription) и содержимое. flush — таблица прижимается к краям карточки.
 */
export function Section({ title, description, flush = false, className, children, ...props }) {
  return (
    <Card className={cn('gap-0 py-0', className)} {...props}>
      <CardHeader className="gap-1 px-4 pt-4 pb-3">
        <CardTitle className="text-sm font-medium">{title}</CardTitle>
        {description}
      </CardHeader>
      <CardContent className={flush ? 'px-0 pb-0' : 'px-4 pb-4'}>{children}</CardContent>
    </Card>
  );
}
