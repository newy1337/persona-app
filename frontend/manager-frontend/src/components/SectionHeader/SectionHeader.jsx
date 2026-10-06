import { ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { NativeSelect } from '@/components/ui/native-select';
import { IconAction } from '../IconAction/IconAction';

export const SHOW_OPTIONS = [3, 6, 9, 12];

/**
 * Шапка секции с карточками: заголовок, счётчик и тихий правый блок —
 * «Показать N» и листание. Доп. контролы секции (например, галочка ручного
 * режима) передаются детьми и встают перед селектом.
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
    <div className={cn('mb-2 flex min-h-8 flex-wrap items-center justify-between gap-x-3 gap-y-1', className)}>
      <div className="flex min-w-0 items-center gap-2">
        <h2 className="text-sm font-medium">{title}</h2>
        <Badge variant="outline" className="h-5 min-w-7 font-normal tabular-nums text-muted-foreground">
          {count}
        </Badge>
      </div>

      <div className="flex items-center gap-1">
        {children}
        <NativeSelect
          aria-label="Показать"
          className="mr-1 h-8 w-auto text-xs"
          value={showCount}
          onChange={(e) => onShowCount(Number(e.target.value))}
        >
          {SHOW_OPTIONS.map((opt) => (
            <option key={opt} value={opt}>
              Показать {opt}
            </option>
          ))}
        </NativeSelect>

        <IconAction
          icon={ChevronLeft}
          label="Предыдущая страница"
          onClick={() => onPage(Math.max(1, page - 1))}
          disabled={page === 1}
        />
        <span className="hidden min-w-10 text-center text-xs tabular-nums text-muted-foreground sm:inline-block">
          {page} / {totalPages}
        </span>
        <IconAction
          icon={ChevronRight}
          label="Следующая страница"
          onClick={() => onPage(Math.min(totalPages, page + 1))}
          disabled={page === totalPages}
        />
      </div>
    </div>
  );
}

export default SectionHeader;
