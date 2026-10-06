import { X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { describe, isActive } from './filters';

/**
 * Заданные фильтры колонок одной строкой: «Стадия: первое касание ×».
 * Нужна, чтобы было видно, почему список короче, и чтобы снять фильтр одним
 * кликом. Без заданных фильтров ничего не рисует — место под строку держит
 * вызывающая сторона.
 *
 *   columns: [{ key, label, filter }] — колонки таблицы с описанием фильтра
 */
export function FilterChips({ columns, state, onChange, onReset, className }) {
  const active = columns.filter((col) => col.filter && isActive(state?.[col.key]));
  if (!active.length) return null;
  return (
    <div className={cn('flex min-w-0 flex-wrap items-center gap-1.5', className)} role="group" aria-label="Заданные фильтры">
      {active.map((col) => (
        <Badge key={col.key} variant="secondary" className="h-6 max-w-64 gap-1 pr-0.5 font-normal">
          <span className="truncate">
            <span className="text-muted-foreground">{col.label}: </span>
            {describe(col.filter, state[col.key])}
          </span>
          <button
            type="button"
            aria-label={`Убрать фильтр: ${col.label}`}
            className="grid size-5 shrink-0 place-items-center rounded-sm text-muted-foreground outline-none hover:bg-background/60 hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50"
            onClick={() => onChange(col.key, col.filter.type === 'options' ? [] : '')}
          >
            <X className="size-3" aria-hidden="true" />
          </button>
        </Badge>
      ))}
      {active.length > 1 && (
        <Button type="button" variant="ghost" size="xs" className="font-normal text-muted-foreground" onClick={onReset}>
          Сбросить все
        </Button>
      )}
    </div>
  );
}
