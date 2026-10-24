import { useEffect, useRef, useState } from 'react';
import { NavLink, useMatch } from 'react-router-dom';
import * as PopoverPrimitive from '@radix-ui/react-popover';
import { ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import { PopoverContent } from '@/components/ui/popover';

const CLOSE_DELAY_MS = 150;

/**
 * Пункт «Настройки» в шапке: наведение (или фокус с клавиатуры) раскрывает
 * список подвкладок роли, клик по самому пункту ведёт на первую подвкладку.
 * Список рисуется поверх страницы (портал): полоса меню в шапке прокручивается
 * и обрезала бы обычный выпадающий блок.
 */
export default function SettingsMenu({ item, tabs, className }) {
  const [open, setOpen] = useState(false);
  // Обёртка Radix (asChild) склеивает className строкой — функцию NavLink она
  // испортила бы, поэтому «активен ли пункт» считаем сами.
  const active = Boolean(useMatch({ path: item.to, end: false }));
  const timer = useRef(null);
  const show = () => {
    clearTimeout(timer.current);
    setOpen(true);
  };
  // Небольшая задержка: курсор успевает дойти от пункта до списка.
  const hide = () => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setOpen(false), CLOSE_DELAY_MS);
  };
  useEffect(() => () => clearTimeout(timer.current), []);

  return (
    <PopoverPrimitive.Root open={open} onOpenChange={setOpen}>
      <PopoverPrimitive.Anchor asChild>
        <NavLink
          to={item.to}
          className={cn(className({ isActive: active }), 'gap-1')}
          aria-haspopup="menu"
          aria-expanded={open}
          onMouseEnter={show}
          onMouseLeave={hide}
          onFocus={show}
          onBlur={hide}
          onClick={() => setOpen(false)}
        >
          {item.label}
          <ChevronDown className={cn('size-3.5 opacity-60 transition-transform', open && 'rotate-180')} aria-hidden="true" />
        </NavLink>
      </PopoverPrimitive.Anchor>
      <PopoverContent
        align="start"
        sideOffset={6}
        className="w-56 p-1"
        role="menu"
        aria-label="Разделы настроек"
        onMouseEnter={show}
        onMouseLeave={hide}
        // Наведение не должно уводить фокус в список и обратно.
        onOpenAutoFocus={(event) => event.preventDefault()}
        onCloseAutoFocus={(event) => event.preventDefault()}
      >
        {tabs.map((tab) => (
          <NavLink
            key={tab.key}
            to={tab.to}
            role="menuitem"
            onFocus={show}
            onBlur={hide}
            onClick={() => setOpen(false)}
            className={({ isActive }) =>
              cn(
                'flex h-8 items-center rounded-md px-2 text-sm text-muted-foreground outline-none hover:bg-accent hover:text-foreground focus-visible:bg-accent focus-visible:text-foreground',
                isActive && 'bg-accent font-medium text-foreground',
              )
            }
          >
            {tab.label}
          </NavLink>
        ))}
      </PopoverContent>
    </PopoverPrimitive.Root>
  );
}
