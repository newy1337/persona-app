import { Columns3 } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { IconAction } from '../IconAction/IconAction';

const keepOpen = (e) => e.preventDefault();

/**
 * «Настроить поля»: иконка в заголовке колонки действий. В меню — по галочке
 * на каждую скрываемую колонку (меню не закрывается, пока их переключают) и
 * «Сбросить». prefs — то, что вернул useColumnPrefs.
 */
export function ColumnPicker({ prefs, label = 'Настроить поля' }) {
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <IconAction icon={Columns3} label={label} />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        {prefs.options.map((option) => (
          <DropdownMenuCheckboxItem
            key={option.key}
            checked={option.checked}
            onCheckedChange={() => prefs.toggle(option.key)}
            onSelect={keepOpen}
          >
            {option.label}
          </DropdownMenuCheckboxItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem
          inset
          disabled={prefs.isDefault}
          onSelect={(e) => {
            keepOpen(e);
            prefs.reset();
          }}
        >
          Сбросить
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
