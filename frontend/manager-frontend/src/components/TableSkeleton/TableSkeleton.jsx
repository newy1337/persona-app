import { cn } from '@/lib/utils';
import { Skeleton } from '@/components/ui/skeleton';
import { CELL, COLUMNS, HEAD_CELL, LINE_1, LINE_2, TABLE_MIN_WIDTH, WIDE_ONLY } from '../ConversationsTable/rowLayout';

const colStyle = (width) => (width ? { width, flex: 'none' } : { flex: '1 1 0%' });

/**
 * Заглушка первой загрузки списка диалогов. Собрана из тех же колонок и той
 * же высоты ячейки, что и настоящая таблица (rowLayout.js), поэтому появление
 * данных ничего не сдвигает. Строки — прямые <div>-дети role=status.
 */
function TableSkeleton({ rows = 6, label = 'Загружаем…' }) {
  return (
    <div
      role="status"
      aria-live="polite"
      aria-busy="true"
      className="overflow-hidden rounded-lg border bg-card"
    >
      <span className="sr-only">{label}</span>
      <div className={cn('box-content flex h-9 border-b', TABLE_MIN_WIDTH)}>
        {COLUMNS.map((col) => (
          <div
            key={col.key}
            style={colStyle(col.width)}
            className={cn(HEAD_CELL, 'flex h-auto items-center', col.wide && WIDE_ONLY)}
          >
            {col.quiet ? null : col.label}
          </div>
        ))}
      </div>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className={cn('flex border-b last:border-0', TABLE_MIN_WIDTH)}>
          {COLUMNS.map((col, c) => (
            <div
              key={col.key}
              style={colStyle(col.width)}
              className={cn(CELL, 'flex min-w-0 items-center gap-2.5', col.wide && WIDE_ONLY)}
            >
              {c === 0 && <Skeleton className="size-8 shrink-0 rounded-full" />}
              <div className="min-w-0 flex-1">
                {col.bars[0] && (
                  <div className={LINE_1}><Skeleton className={cn('h-3.5 max-w-full', col.bars[0])} /></div>
                )}
                {col.bars[1] && (
                  <div className={LINE_2}><Skeleton className={cn('h-3 max-w-full', col.bars[1])} /></div>
                )}
              </div>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

export default TableSkeleton;
