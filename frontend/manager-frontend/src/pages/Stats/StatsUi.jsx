import { cn } from '@/lib/utils';
import { Skeleton } from '@/components/ui/skeleton';
import { TableCell, TableRow } from '@/components/ui/table';

// Форматтеры и общие классы таблиц статистики — одни на все карточки страницы.
export const money = (x) => (x >= 1 ? `$${x.toFixed(2)}` : `$${(x ?? 0).toFixed(4)}`);
export const num = (x) => (x ?? 0).toLocaleString('ru-RU');
export const kilo = (x) =>
  x >= 1e6 ? `${(x / 1e6).toFixed(1)} млн` : x >= 1e3 ? `${(x / 1e3).toFixed(1)} тыс.` : String(x ?? 0);
export const pct = (x) => `${Math.round((x ?? 0) * 100)}%`;
export const shortDay = (d) => d.slice(5).split('-').reverse().join('.');

export const TH = 'h-9 px-3 text-xs font-medium text-muted-foreground';
export const TD = 'p-3 align-top whitespace-normal [overflow-wrap:anywhere]';
export const NUM = 'text-right tabular-nums whitespace-nowrap';
// Крайние ячейки подравниваются к внутреннему отступу карточки (px-4).
export const EDGE =
  '[&_th:first-child]:pl-4 [&_td:first-child]:pl-4 [&_th:last-child]:pr-4 [&_td:last-child]:pr-4';

/**
 * Блок раздела статистики: одна рамка без тени, заголовок text-sm, необязательное
 * описание (текст или узлы) и содержимое. flush — таблица прижимается к краям
 * блока и отделяется от шапки линией.
 */
export function Section({ title, description, flush = false, className, children, ...props }) {
  return (
    <section className={cn('overflow-hidden rounded-lg border bg-card', className)} {...props}>
      <header className={cn('flex flex-col gap-1 px-4 py-3', flush && 'border-b')}>
        <h2 className="text-sm font-medium">{title}</h2>
        {description && <div className="space-y-1 text-xs text-muted-foreground">{description}</div>}
      </header>
      <div className={flush ? undefined : 'px-4 pb-4'}>{children}</div>
    </section>
  );
}

/**
 * Строки-заглушки первой загрузки: те же TableRow/TableCell и те же классы ячеек,
 * что у настоящих строк, а Skeleton h-5 равен строке text-sm — высота строки
 * совпадает с итоговой по построению. lastCell подменяет последнюю ячейку
 * (колонка действий со своей кнопкой).
 */
export function SkeletonRows({ rows = 5, cols, lastCell = null }) {
  const plain = lastCell ? cols - 1 : cols;
  return Array.from({ length: rows }, (_, r) => (
    <TableRow key={r} className="hover:bg-transparent">
      {Array.from({ length: plain }, (_, c) => (
        <TableCell key={c} className={TD}>
          <Skeleton className={c === 0 ? 'h-5 w-28 max-w-full' : 'ml-auto h-5 w-12'} />
        </TableCell>
      ))}
      {lastCell}
    </TableRow>
  ));
}
