import { Search, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Input } from '@/components/ui/input';

/**
 * Поле поиска для тулбаров списков: лупа слева, крестик очистки справа
 * (место под него занято всегда — ширина текста не прыгает), Esc очищает.
 */
export function SearchInput({
  value,
  onChange,
  className,
  inputClassName,
  'aria-label': ariaLabel = 'Поиск',
  ...props
}) {
  return (
    <div className={cn('relative min-w-0', className)}>
      <Search
        className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
        aria-hidden="true"
      />
      <Input
        type="text"
        aria-label={ariaLabel}
        className={cn('h-8 pr-8 pl-8', inputClassName)}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape' && value) {
            e.preventDefault();
            onChange('');
          }
        }}
        {...props}
      />
      <button
        type="button"
        aria-label="Очистить поиск"
        tabIndex={value ? 0 : -1}
        className={cn(
          'absolute top-1/2 right-1 grid size-6 -translate-y-1/2 place-items-center rounded-sm text-muted-foreground outline-none hover:bg-accent hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50',
          !value && 'invisible',
        )}
        onClick={() => onChange('')}
      >
        <X className="size-3.5" aria-hidden="true" />
      </button>
    </div>
  );
}
