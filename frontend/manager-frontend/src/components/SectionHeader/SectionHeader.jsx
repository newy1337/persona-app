import { ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { NativeSelect } from '@/components/ui/native-select';

export const SHOW_OPTIONS = [3, 6, 9, 12];

/**
 * Шапка секции с карточками: акцентная полоска, заголовок, счётчик и
 * правый блок управления — «Показать N», страницы. Доп. контролы секции
 * (например, галочка ручного режима) передаются детьми и встают перед селектом.
 */
function SectionHeader({
  title,
  count,
  showCount,
  onShowCount,
  page,
  totalPages,
  onPage,
  children,
  className,
}) {
  return (
    <div className={cn('mb-5 flex flex-wrap items-center justify-between gap-3', className)}>
      <div className="flex min-w-0 items-center gap-3">
        <span aria-hidden="true" className="h-5 w-0.5 shrink-0 rounded-full bg-primary" />
        <h2 className="text-[15px] font-bold">{title}</h2>
        <Badge variant="outline" className="h-5 min-w-7 tabular-nums">
          {count}
        </Badge>
      </div>

      <div className="flex items-center gap-2">
        {children}
        <NativeSelect
          aria-label="Показать"
          className="h-8 w-auto"
          value={showCount}
          onChange={(e) => onShowCount(Number(e.target.value))}
        >
          {SHOW_OPTIONS.map((opt) => (
            <option key={opt} value={opt}>
              Показать {opt}
            </option>
          ))}
        </NativeSelect>

        <Button
          variant="outline"
          size="icon"
          className="size-8"
          aria-label="Предыдущая страница"
          onClick={() => onPage(Math.max(1, page - 1))}
          disabled={page === 1}
        >
          <ChevronLeft />
        </Button>
        <span className="hidden min-w-16 text-center font-mono text-xs tabular-nums text-muted-foreground sm:inline-block">
          <span className="text-foreground">{page}</span> / {totalPages}
        </span>
        <Button
          variant="outline"
          size="icon"
          className="size-8"
          aria-label="Следующая страница"
          onClick={() => onPage(Math.min(totalPages, page + 1))}
          disabled={page === totalPages}
        >
          <ChevronRight />
        </Button>
      </div>
    </div>
  );
}

export default SectionHeader;
