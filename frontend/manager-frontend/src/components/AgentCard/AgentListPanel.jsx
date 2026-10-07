import { useEffect, useId, useState } from 'react';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import AgentCard, { ROW_HEIGHT } from './AgentCard';

/** Сколько строк видно в свёрнутой панели: её высота от числа диалогов не зависит. */
export const COLLAPSED_ROWS = 3;

/**
 * Панель-список диалогов: шапка 36px и тело из строк по 40px. Свёрнутое тело
 * всегда ровно в три строки и прокручивается внутри себя, поэтому опрос не
 * двигает страницу; «Все N» раскрывает его до 60% высоты окна.
 */
function AgentListPanel({ title, icon: Icon, count, agents, showAlert = false, loading = false, emptyText, children }) {
  const [open, setOpen] = useState(false);
  const bodyId = useId();
  const canExpand = agents.length > COLLAPSED_ROWS;
  const expanded = open && canExpand;
  // Список сократился до трёх строк — раскрытие сбрасываем: иначе следующая
  // четвёртая строка сама раздвинула бы панель и сдвинула таблицу под ней.
  useEffect(() => {
    if (!canExpand) setOpen(false);
  }, [canExpand]);

  return (
    <section className="@container min-w-0 overflow-hidden rounded-lg border bg-card">
      <div className="flex h-9 items-center gap-2 border-b px-3">
        {Icon && <Icon aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />}
        <h2 className="min-w-0 truncate text-sm font-medium">{title}</h2>
        <Badge variant="outline" className="h-5 min-w-7 font-normal tabular-nums text-muted-foreground">
          {count}
        </Badge>
        <div className="ml-auto flex shrink-0 items-center gap-1">
          {children}
          {/* Место под кнопку занято всегда: шапка не перестраивается, когда строк становится больше трёх. */}
          <Button
            type="button"
            variant="ghost"
            size="xs"
            aria-expanded={expanded}
            aria-controls={bodyId}
            aria-hidden={canExpand ? undefined : true}
            tabIndex={canExpand ? undefined : -1}
            disabled={!canExpand}
            onClick={() => setOpen((v) => !v)}
            className={cn('min-w-[4.75rem] font-normal text-muted-foreground tabular-nums', !canExpand && 'invisible')}
          >
            {expanded ? 'Свернуть' : `Все ${agents.length}`}
          </Button>
        </div>
      </div>

      <div
        id={bodyId}
        data-testid="agent-list"
        data-expanded={expanded ? 'true' : 'false'}
        className={cn(
          'overflow-y-auto [scrollbar-gutter:stable]',
          expanded ? 'max-h-[60vh] min-h-[120px]' : 'h-[120px]',
        )}
      >
        {agents.length ? (
          <div className="divide-y">
            {agents.map((agent) => (
              <AgentCard key={agent.chat_id} agent={agent} showAlert={showAlert} />
            ))}
          </div>
        ) : loading ? (
          <div className="divide-y" aria-hidden="true">
            {Array.from({ length: COLLAPSED_ROWS }, (_, i) => (
              <div key={i} className={cn(ROW_HEIGHT, 'flex items-center gap-2 px-3')}>
                <Skeleton className="size-6 shrink-0 rounded-full" />
                <Skeleton className="h-3.5 w-40 max-w-[50%]" />
                <Skeleton className="ml-auto h-3.5 w-10" />
              </div>
            ))}
          </div>
        ) : (
          <p className="flex h-full items-center justify-center px-3 text-center text-sm text-muted-foreground">
            {emptyText}
          </p>
        )}
      </div>
    </section>
  );
}

export default AgentListPanel;
