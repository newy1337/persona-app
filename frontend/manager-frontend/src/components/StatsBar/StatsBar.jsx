import { useState } from 'react';
import { Calendar, ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Skeleton } from '@/components/ui/skeleton';

const PRESETS = [
  { key: '', label: 'Вся история' },
  { key: 'today', label: 'Сегодня' },
  { key: 'yesterday', label: 'Вчера' },
  { key: '7d', label: '7 дней' },
  { key: '30d', label: '30 дней' },
];

function labelFor(dateFilter) {
  if (!dateFilter) return 'Период: всё время';
  if (String(dateFilter).startsWith('date:')) return dateFilter.slice(5);
  return PRESETS.find((p) => p.key === dateFilter)?.label ?? 'Период';
}

/**
 * Плитки сводки. Подписи рисуются сразу, значения до прихода статистики —
 * Skeleton той же высоты, чтобы строка не прыгала. Фильтр по дате — в правом
 * углу строки над плитками.
 */
function StatsBar({ stats = [], dateFilter = '', onDateFilterChange }) {
  const [open, setOpen] = useState(false);

  const pick = (value) => {
    onDateFilterChange?.(value);
    setOpen(false);
  };
  const dateValue = String(dateFilter).startsWith('date:') ? dateFilter.slice(5) : '';
  const filtered = Boolean(dateFilter);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex min-h-8 items-center justify-end gap-2">
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <Button
              variant={filtered ? 'secondary' : 'outline'}
              size="sm"
              aria-pressed={filtered}
              title="Фильтр по дате последнего сообщения"
            >
              <Calendar />
              <span>{labelFor(dateFilter)}</span>
              <ChevronDown className="opacity-60" />
            </Button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-60 p-1.5">
            <div className="flex flex-col">
              {PRESETS.map((p) => (
                <Button
                  key={p.key || 'all'}
                  variant="ghost"
                  size="sm"
                  className={cn('justify-start font-normal', dateFilter === p.key && 'bg-accent')}
                  aria-pressed={dateFilter === p.key}
                  onClick={() => pick(p.key)}
                >
                  {p.label}
                </Button>
              ))}
            </div>
            <Label className="mt-1.5 flex items-center justify-between gap-2 border-t px-2 pt-2.5 pb-1 text-xs font-normal text-muted-foreground">
              Дата
              <Input
                type="date"
                className="h-8 w-auto px-2 text-xs"
                value={dateValue}
                onChange={(e) => onDateFilterChange?.(e.target.value ? `date:${e.target.value}` : '')}
              />
            </Label>
            <Button
              variant="ghost"
              size="sm"
              className="mt-1 w-full justify-start font-normal text-muted-foreground"
              disabled={!filtered}
              onClick={() => pick('')}
            >
              Сбросить
            </Button>
          </PopoverContent>
        </Popover>
      </div>

      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border bg-border lg:grid-cols-5">
        {stats.map((stat) => (
          <div key={stat.id} className="flex flex-col gap-1 bg-card p-4">
            <span className="truncate text-xs text-muted-foreground">{stat.label}</span>
            {stat.value == null ? (
              <Skeleton className="h-7 w-12" />
            ) : (
              <span className="min-h-[22px] min-w-[3ch] text-[22px] leading-7 font-semibold tabular-nums">
                {stat.value}
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

export default StatsBar;
