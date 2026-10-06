import { Archive, ArrowLeft, SlidersHorizontal } from 'lucide-react';
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
      <PopoverContent align="start" className="flex w-[280px] flex-col gap-4 p-4">
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
 * Тулбар страницы диалогов — одна строка: поиск, фильтры, «Новые на ручном»
 * и справа переход в архив. Кнопки смонтированы всегда (выключаются через
 * disabled), поэтому строка не перестраивается при обновлении данных.
 */
export function DialogsToolbar({
  query,
  onQueryChange,
  filters,
  onFiltersChange,
  accounts = [],
  newCount = 0,
  onlyNew = false,
  onOnlyNewChange = null,
  showHidden = false,
  onToggleShowHidden = null,
  className,
  children,
}) {
  return (
    <div className={cn('flex min-h-8 flex-wrap items-center gap-2', className)}>
      <SearchInput
        className="w-full sm:w-[320px]"
        placeholder="Имя, номер, город, chat_id…"
        aria-label="Поиск по диалогам"
        value={query}
        onChange={onQueryChange}
      />
      <DialogFilters value={filters} onChange={onFiltersChange} accounts={accounts} />
      {onOnlyNewChange && (
        <Button
          type="button"
          variant={onlyNew ? 'secondary' : 'outline'}
          size="sm"
          aria-pressed={onlyNew}
          disabled={newCount === 0 && !onlyNew}
          onClick={() => onOnlyNewChange(!onlyNew)}
          title="Чаты на ручном режиме, где клиент написал, а переписку ещё не открывали"
          data-testid="filter-new"
          className="shrink-0 font-normal"
        >
          Новые на ручном ·{' '}
          <span className="min-w-[2ch] text-left tabular-nums">{newCount}</span>
        </Button>
      )}
      {children}
      {onToggleShowHidden && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="ml-auto shrink-0 font-normal"
          onClick={() => onToggleShowHidden(!showHidden)}
        >
          {showHidden ? <ArrowLeft aria-hidden="true" /> : <Archive aria-hidden="true" />}
          {showHidden ? 'Вернуться к диалогам' : 'Архив'}
        </Button>
      )}
    </div>
  );
}
