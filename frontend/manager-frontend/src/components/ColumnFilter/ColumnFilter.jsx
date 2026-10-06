import { useState } from 'react';
import { Funnel } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { PERIODS, isActive } from './filters';

const ROW =
  'flex h-8 w-full min-w-0 cursor-pointer items-center gap-2 rounded-md px-2 text-left text-sm outline-none hover:bg-accent focus-visible:bg-accent';
const SEARCH_FROM = 9;

function Head({ label, active, onReset }) {
  return (
    <div className="flex h-7 items-center justify-between gap-2 px-2">
      <span className="truncate text-xs font-medium text-muted-foreground">{label}</span>
      <Button type="button" variant="ghost" size="xs" className="-mr-1.5 font-normal" disabled={!active} onClick={onReset}>
        Сбросить
      </Button>
    </div>
  );
}

function OptionsBody({ def, value, onChange }) {
  const [query, setQuery] = useState('');
  const picked = Array.isArray(value) ? value.map(String) : [];
  const needle = query.trim().toLowerCase();
  const shown = needle ? def.options.filter((o) => String(o.label).toLowerCase().includes(needle)) : def.options;
  const toggle = (option) => {
    const key = String(option.value);
    onChange(picked.includes(key) ? picked.filter((v) => v !== key) : [...picked, key]);
  };
  return (
    <>
      {def.options.length >= SEARCH_FROM && (
        <Input
          className="mb-1"
          aria-label="Найти значение"
          placeholder="Найти…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      )}
      <div className="max-h-64 overflow-y-auto [scrollbar-gutter:stable]" role="group">
        {shown.map((option) => (
          <label key={String(option.value)} className={ROW}>
            <Checkbox checked={picked.includes(String(option.value))} onCheckedChange={() => toggle(option)} />
            {option.color && (
              <span aria-hidden="true" className="size-1.5 shrink-0 rounded-full" style={{ background: option.color }} />
            )}
            <span className="min-w-0 flex-1 truncate" title={option.label}>{option.label}</span>
            {option.count != null && <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{option.count}</span>}
          </label>
        ))}
        {shown.length === 0 && <p className="px-2 py-2 text-xs text-muted-foreground">Ничего не найдено</p>}
      </div>
    </>
  );
}

function PeriodBody({ value, onChange }) {
  return (
    <div role="group">
      {PERIODS.map((period) => {
        const on = value === period.value;
        return (
          <button
            key={period.value}
            type="button"
            aria-pressed={on}
            className={cn(ROW, on && 'bg-accent font-medium')}
            onClick={() => onChange(on ? '' : period.value)}
          >
            {period.label}
          </button>
        );
      })}
    </div>
  );
}

function TextBody({ def, label, value, onChange }) {
  return (
    <Input
      autoFocus
      aria-label={`${label}: содержит`}
      placeholder={def.placeholder || 'Содержит…'}
      value={value ?? ''}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

/**
 * Фильтр колонки: значок-воронка рядом с названием колонки, по клику —
 * поповер с настройкой. Значение применяется сразу, без кнопки «Применить».
 * Заданный фильтр виден по синей воронке с точкой.
 *
 *   def.type: 'options' (галочки, несколько значений) | 'text' («содержит») | 'period'
 */
export function ColumnFilter({ label, def, value, onChange, align = 'start' }) {
  const active = isActive(value);
  const empty = def.type === 'options' ? [] : '';
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={`Фильтр: ${label}`}
          title={active ? `Фильтр по колонке «${label}» включён` : `Фильтр по колонке «${label}»`}
          data-active={active ? '' : undefined}
          className={cn(
            'relative grid size-6 shrink-0 place-items-center rounded-sm text-muted-foreground/60 outline-none transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 data-[state=open]:bg-accent data-[state=open]:text-foreground',
            active && 'text-primary hover:text-primary data-[state=open]:text-primary',
          )}
        >
          <Funnel className="size-3.5" aria-hidden="true" />
          {active && <span aria-hidden="true" className="absolute top-0.5 right-0.5 size-1.5 rounded-full bg-primary" />}
        </button>
      </PopoverTrigger>
      <PopoverContent align={align} className="w-60 p-1.5">
        <Head label={label} active={active} onReset={() => onChange(empty)} />
        {def.type === 'options' && <OptionsBody def={def} value={value} onChange={onChange} />}
        {def.type === 'period' && <PeriodBody value={value} onChange={onChange} />}
        {def.type === 'text' && <TextBody def={def} label={label} value={value} onChange={onChange} />}
      </PopoverContent>
    </Popover>
  );
}
