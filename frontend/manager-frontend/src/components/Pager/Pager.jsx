import { useState } from 'react';
import { ChevronLeft, ChevronRight, MoreHorizontal } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { NativeSelect } from '@/components/ui/native-select';
import { pageItems } from './pageItems';

/**
 * Поле «Стр. N из M»: переход по Enter или при уходе из поля с изменённым
 * значением. Число прижимается к 1…pages, не-число отбрасывается, и поле
 * снова показывает текущую страницу.
 */
function PageJump({ current, pages, onPage }) {
  // null — поле показывает текущую страницу; строка — то, что набирает человек.
  const [draft, setDraft] = useState(null);

  const commit = () => {
    if (draft === null) return;
    setDraft(null);
    const text = draft.trim();
    if (!/^\d+$/.test(text)) return;
    const target = Math.min(Math.max(1, Number(text)), pages);
    if (target !== current) onPage(target);
  };

  return (
    <div className="flex items-center gap-1.5 text-xs tabular-nums text-muted-foreground">
      <span aria-hidden="true">Стр.</span>
      <Input
        type="text"
        inputMode="numeric"
        autoComplete="off"
        aria-label="Перейти к странице"
        className="h-8 w-12 px-1 text-center text-xs tabular-nums text-foreground md:text-xs"
        value={draft ?? String(current)}
        onChange={(e) => setDraft(e.target.value)}
        onFocus={(e) => e.target.select()}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key !== 'Enter') return;
          e.preventDefault();
          commit();
        }}
      />
      <span>из {pages}</span>
    </div>
  );
}

/**
 * Постраничный переключатель списков. Слева — «Всего: 312 · 1–25», справа —
 * выбор размера страницы (если передан onPageSize), переход к странице (когда
 * страниц больше семи) и номера со стрелками. Номера видны всегда, в том числе
 * для единственной страницы: «‹ 1 ›» с выключенными стрелками.
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
  const from = (current - 1) * pageSize + 1;
  const to = Math.min(current * pageSize, total);

  return (
    <div className={cn('flex min-h-8 flex-wrap items-center justify-between gap-x-4 gap-y-2', className)}>
      <span className="text-xs tabular-nums text-muted-foreground" role="status">
        Всего: <span className="font-medium text-foreground">{total}</span>
        {total > 0 && ` · ${from}–${to}`}
      </span>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
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
        {pages > 7 && <PageJump current={current} pages={pages} onPage={onPage} />}
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
      </div>
    </div>
  );
}
