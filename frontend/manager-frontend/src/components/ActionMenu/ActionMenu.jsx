import { ChevronDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

/**
 * Меню «Ещё» для редких действий строки: главные кнопки остаются на виду,
 * остальное прячется за одной кнопкой и не растягивает строку.
 * items: [{ label, onSelect, danger, disabled, title }] — null/false пропускаются.
 */
export default function ActionMenu({ items, label = 'Ещё', small = true, ariaLabel }) {
  const list = items.filter(Boolean);
  if (!list.length) return null;
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <Button type="button" variant="outline" size={small ? 'sm' : 'default'} aria-label={ariaLabel}>
          {label}
          <ChevronDown aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-44">
        {list.map((item) => (
          <DropdownMenuItem
            key={item.label}
            variant={item.danger ? 'destructive' : 'default'}
            disabled={item.disabled}
            title={item.title}
            onSelect={() => item.onSelect()}
          >
            {item.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
