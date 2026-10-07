import { cn } from '@/lib/utils';
import { Skeleton } from '@/components/ui/skeleton';
import { CELL, HEAD_CELL, LINE_1, LINE_2, useDialogColumns } from '../ConversationsTable/rowLayout';

/**
 * Заглушка первой загрузки списка диалогов. Собрана из тех же видимых колонок
 * и той же высоты ячейки, что и настоящая таблица (rowLayout.js), поэтому
 * появление данных ничего не сдвигает. Строки — прямые <div>-дети role=status.
 */
function TableSkeleton({ rows = 6, label = 'Загружаем…' }) {
  const { columns, minWidth } = useDialogColumns();
  // Как в таблице с фиксированной раскладкой: остаток забирает гибкая колонка,
  // а если она скрыта — его делят остальные, пропорционально своей ширине.
  const flexible = columns.some((col) => !col.width);
  const colStyle = ({ width }) => {
    if (!width) return { flex: '1 1 0%' };
    return flexible ? { width, flex: 'none' } : { flex: `${width} 0 ${width}px` };
  };

  return (
    <div
      role="status"
      aria-live="polite"
      aria-busy="true"
      className="overflow-hidden rounded-lg border bg-card"
    >
      <span className="sr-only">{label}</span>
      <div className="box-content flex h-9 border-b" style={{ minWidth }}>
        {columns.map((col) => (
          <div key={col.key} style={colStyle(col)} className={cn(HEAD_CELL, 'flex h-auto items-center')}>
            {col.quiet ? null : col.label}
          </div>
        ))}
      </div>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex border-b last:border-0" style={{ minWidth }}>
          {columns.map((col) => (
            <div key={col.key} style={colStyle(col)} className={cn(CELL, 'flex min-w-0 items-center gap-2.5')}>
              {col.key === 'who' && <Skeleton className="size-8 shrink-0 rounded-full" />}
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
