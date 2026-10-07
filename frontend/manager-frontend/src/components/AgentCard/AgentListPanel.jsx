import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import AgentCard, { ROW_HEIGHT } from './AgentCard';

/**
 * Панель-список диалогов: шапка 36px и строки по 40px в два столбца (на узком
 * экране — в один). Высота панели идёт за числом диалогов: пусто — одна
 * строка, дальше по строке на каждые два диалога. Очень длинный список
 * (больше десяти строк) прокручивается внутри панели, чтобы таблица под ней
 * не уезжала за экран.
 *
 * Каждая ячейка — свой контейнер для container query: строка сама решает,
 * какие колонки показать, по ширине своего столбца, а не всей панели.
 */
function AgentListPanel({ title, icon: Icon, count, agents, loading = false, emptyText, children }) {
  return (
    <section className="min-w-0 overflow-hidden rounded-lg border bg-card">
      <div className="flex h-9 items-center gap-2 border-b px-3">
        {Icon && <Icon aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />}
        <h2 className="min-w-0 truncate text-sm font-medium">{title}</h2>
        <Badge variant="outline" className="h-5 min-w-7 font-normal tabular-nums text-muted-foreground">
          {count}
        </Badge>
        {children && <div className="ml-auto flex shrink-0 items-center gap-1">{children}</div>}
      </div>

      <div data-testid="agent-list" className="max-h-[400px] overflow-y-auto [scrollbar-gutter:stable]">
        {agents.length ? (
          // Линии — сверху ячеек, у первого ряда их нет: так под последним рядом
          // не остаётся лишней линии и список не получает прокрутку в один пиксель.
          <div className="grid lg:grid-cols-2">
            {agents.map((agent) => (
              <div
                key={agent.chat_id}
                className="@container min-w-0 border-t first:border-t-0 lg:odd:border-r lg:[&:nth-child(2)]:border-t-0"
              >
                <AgentCard agent={agent} />
              </div>
            ))}
          </div>
        ) : loading ? (
          <div className="grid lg:grid-cols-2" aria-hidden="true">
            {[0, 1].map((i) => (
              <div key={i} className={cn(ROW_HEIGHT, 'flex items-center gap-2 px-3', i === 1 && 'max-lg:hidden')}>
                <Skeleton className="size-6 shrink-0 rounded-full" />
                <Skeleton className="h-3.5 w-40 max-w-[50%]" />
                <Skeleton className="ml-auto h-3.5 w-10" />
              </div>
            ))}
          </div>
        ) : (
          <p className={cn(ROW_HEIGHT, 'flex items-center justify-center px-3 text-center text-sm text-muted-foreground')}>
            {emptyText}
          </p>
        )}
      </div>
    </section>
  );
}

export default AgentListPanel;
