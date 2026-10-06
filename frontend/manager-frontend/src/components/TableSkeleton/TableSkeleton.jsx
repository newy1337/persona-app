import { Skeleton } from '@/components/ui/skeleton';

/**
 * Заглушка на время загрузки. Держит высоту списка: без неё страница
 * схлопывается до одного экрана, сбрасывает прокрутку и успевает показать
 * «данных нет» раньше, чем данные приходят. Строки — прямые <div>-дети
 * role=status, высотой с реальную строку таблицы.
 */
function TableSkeleton({ rows = 6, label = 'Загружаем…' }) {
  return (
    <div role="status" aria-live="polite" aria-busy="true" className="flex flex-col gap-2.5 py-2">
      <span className="font-mono text-[11px] text-muted-foreground">{label}</span>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex h-24 items-center gap-4 rounded-lg border bg-card px-3">
          <Skeleton className="size-9 shrink-0 rounded-lg" />
          <div className="flex flex-[2] flex-col gap-2">
            <Skeleton className="h-3 w-2/5" />
            <Skeleton className="h-3 w-3/5" />
          </div>
          <Skeleton className="h-3 flex-1" />
          <Skeleton className="hidden h-3 flex-1 md:block" />
          <Skeleton className="h-8 w-20 shrink-0" />
        </div>
      ))}
    </div>
  );
}

export default TableSkeleton;
