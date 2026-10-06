import { Skeleton } from '@/components/ui/skeleton';

/**
 * Сводка страницы: одна полоса с ячейками «подпись → число». Подписи рисуются
 * сразу, значение до первого ответа — Skeleton в слоте той же высоты, так что
 * приход чисел и их обновление каждые десять секунд ничего не сдвигают.
 * На узком экране полоса прокручивается по горизонтали.
 */
function StatsBar({ stats = [] }) {
  return (
    <div className="grid auto-cols-[minmax(132px,1fr)] grid-flow-col divide-x overflow-x-auto rounded-lg border bg-card [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      {stats.map((stat) => (
        <div key={stat.id} className="flex min-w-0 flex-col gap-0.5 px-4 py-2.5">
          <span className="truncate text-xs text-muted-foreground" title={stat.label}>{stat.label}</span>
          <span className="flex h-7 min-w-[3ch] items-center text-lg font-semibold tabular-nums">
            {stat.value == null ? <Skeleton className="h-5 w-10" /> : stat.value}
          </span>
        </div>
      ))}
    </div>
  );
}

export default StatsBar;
