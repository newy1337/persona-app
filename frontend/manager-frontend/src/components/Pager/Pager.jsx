import { ChevronLeft, ChevronRight, MoreHorizontal } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { NativeSelect } from '@/components/ui/native-select';
import { pageItems } from './pageItems';

/**
 * Постраничный переключатель списков: слева «1–25 из 312», справа номера
 * страниц со стрелками и, если передан onPageSize, выбор размера страницы.
 * Строка всегда одной высоты; <nav> появляется только когда страниц больше одной.
 */
export function Pager({
  page,
  pageSize,
  total,
  onPage,
  pageSizes,
  onPageSize,
  label = 'Страницы',
  className,
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const current = Math.min(Math.max(1, page), pages);
  const from = total === 0 ? 0 : (current - 1) * pageSize + 1;
  const to = Math.min(current * pageSize, total);

  return (
    <div className={cn('flex min-h-8 flex-wrap items-center justify-between gap-x-4 gap-y-2', className)}>
      <span className="text-xs tabular-nums text-muted-foreground" role="status">
        {total === 0 ? 'Нет записей' : `${from}–${to} из ${total}`}
      </span>
      <div className="flex items-center gap-3">
        {onPageSize && (
          <NativeSelect
            aria-label="Строк на странице"
            className="h-8 w-auto text-xs"
            value={pageSize}
            onChange={(e) => onPageSize(Number(e.target.value))}
          >
            {pageSizes.map((n) => (
              <option key={n} value={n}>по {n}</option>
            ))}
          </NativeSelect>
        )}
        {pages > 1 && (
          <nav className="flex items-center gap-0.5" aria-label={label}>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label="Предыдущая страница"
              disabled={current === 1}
              onClick={() => onPage(current - 1)}
            >
              <ChevronLeft aria-hidden="true" />
            </Button>
            {pageItems(current, pages).map((item) =>
              typeof item === 'number' ? (
                <Button
                  key={item}
                  type="button"
                  variant={item === current ? 'outline' : 'ghost'}
                  size="icon-sm"
                  aria-label={`Страница ${item}`}
                  aria-current={item === current ? 'page' : undefined}
                  className={cn('w-auto min-w-8 px-2 text-xs tabular-nums', item !== current && 'text-muted-foreground')}
                  onClick={() => onPage(item)}
                >
                  {item}
                </Button>
              ) : (
                <span key={item} className="grid size-8 place-items-center text-muted-foreground" aria-hidden="true">
                  <MoreHorizontal className="size-4" />
                </span>
              ),
            )}
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label="Следующая страница"
              disabled={current === pages}
              onClick={() => onPage(current + 1)}
            >
              <ChevronRight aria-hidden="true" />
            </Button>
          </nav>
        )}
      </div>
    </div>
  );
}
