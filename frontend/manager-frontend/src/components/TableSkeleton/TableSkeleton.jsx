import { cn } from '@/lib/utils';
import { Skeleton } from '@/components/ui/skeleton';
import { CELL, COLUMNS, HEAD_CELL, LINE_1, LINE_2, TABLE_MIN_WIDTH } from '../ConversationsTable/rowLayout';

// Ширины полосок по колонкам: [первая строка, вторая строка].
const BARS = [
  ['w-28', 'w-40'],
  ['w-36', 'w-44'],
  ['w-32', 'w-24'],
  ['w-10', 'w-14'],
  [null, null],
];

const colStyle = (width) => (width ? { width, flex: 'none' } : { flex: '1 1 0%' });

/**
 * Заглушка первой загрузки списка диалогов. Собрана из тех же колонок и тех
 * же двух строк в ячейке, что и настоящая таблица (rowLayout.js), поэтому
 * появление данных ничего не сдвигает. Строки — прямые <div>-дети role=status.
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
          <div key={col.label} style={colStyle(col.width)} className={cn(HEAD_CELL, 'flex h-auto items-center')}>
            {col.quiet ? null : col.label}
          </div>
        ))}
      </div>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className={cn('flex border-b last:border-0', TABLE_MIN_WIDTH)}>
          {COLUMNS.map((col, c) => (
            <div key={col.label} style={colStyle(col.width)} className={cn(CELL, 'min-w-0')}>
              <div className="flex min-w-0 items-center gap-3">
                {c === 0 && <Skeleton className="size-9 shrink-0 rounded-full" />}
                <div className="min-w-0 flex-1">
                  <div className={LINE_1}>{BARS[c][0] && <Skeleton className={cn('h-3.5 max-w-full', BARS[c][0])} />}</div>
                  <div className={LINE_2}>{BARS[c][1] && <Skeleton className={cn('h-3 max-w-full', BARS[c][1])} />}</div>
                </div>
              </div>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

export default TableSkeleton;
