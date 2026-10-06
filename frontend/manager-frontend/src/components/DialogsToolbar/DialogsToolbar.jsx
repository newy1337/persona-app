import { SlidersHorizontal } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { SearchInput } from '../SearchInput/SearchInput';

const LEAD_OPTIONS = [
  { key: '', label: 'любой' },
  { key: 'bot', label: 'бот' },
  { key: 'manager', label: 'менеджер' },
];

function Option({ active, children, ...props }) {
  return (
    <Button
      type="button"
      size="xs"
      variant={active ? 'secondary' : 'outline'}
      aria-pressed={active}
      className="font-normal"
      {...props}
    >
      {children}
    </Button>
  );
}

function Group({ title, children }) {
  return (
    <div className="flex flex-col gap-2">
      <span className="text-xs text-muted-foreground">{title}</span>
      <div className="flex flex-wrap gap-1.5">{children}</div>
    </div>
  );
}

/** Фильтры списка диалогов: кто ведёт и с какого аккаунта. */
function DialogFilters({ value, onChange, accounts }) {
  const set = (patch) => onChange({ ...value, ...patch });
  const active = Number(Boolean(value.lead)) + Number(Boolean(value.account));

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button type="button" variant="outline" size="sm" className="shrink-0 data-[state=open]:bg-accent">
          <SlidersHorizontal aria-hidden="true" />
          Фильтры
          <Badge
            variant="secondary"
            className={cn('h-5 min-w-5 px-1 tabular-nums', !active && 'hidden')}
            aria-label={`Включено фильтров: ${active}`}
          >
            {active}
          </Badge>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="flex w-[280px] flex-col gap-4 p-4">
        <div className="flex min-h-5 items-center justify-between">
          <span className="text-sm font-medium">Фильтры</span>
          <Button
            type="button"
            variant="link"
            size="sm"
            className={cn('h-auto p-0 text-xs', !active && 'invisible')}
            disabled={!active}
            onClick={() => onChange({ lead: '', account: '' })}
          >
            Сбросить
          </Button>
        </div>
        <Group title="Ведёт">
          {LEAD_OPTIONS.map((o) => (
            <Option key={o.key || 'any'} active={value.lead === o.key} onClick={() => set({ lead: o.key })}>
              {o.label}
            </Option>
          ))}
        </Group>
        <Group title="Аккаунт">
          <Option active={value.account === ''} onClick={() => set({ account: '' })}>любой</Option>
          {accounts.map((a) => (
            <Option key={a} active={value.account === String(a)} onClick={() => set({ account: String(a) })}>
              #{a}
            </Option>
          ))}
        </Group>
      </PopoverContent>
    </Popover>
  );
}

/**
 * Тулбар страницы диалогов: поиск и фильтры. Раньше стояли в шапке панели —
 * там они были видны только на этой странице и растягивали шапку на вторую строку.
 */
export function DialogsToolbar({ query, onQueryChange, filters, onFiltersChange, accounts = [], className, children }) {
  return (
    <div className={cn('flex flex-wrap items-center gap-2', className)}>
      <SearchInput
        className="w-full sm:w-[320px]"
        placeholder="Имя, номер, город, chat_id…"
        aria-label="Поиск по диалогам"
        value={query}
        onChange={onQueryChange}
      />
      <DialogFilters value={filters} onChange={onFiltersChange} accounts={accounts} />
      {children}
    </div>
  );
}
