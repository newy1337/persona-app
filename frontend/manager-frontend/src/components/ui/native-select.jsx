import { cn } from '@/lib/utils';

/**
 * Обычный <select> в оформлении shadcn. В таблицах их десятки, и на каждой
 * строке поповер Radix стоил бы дороже, чем выигрывает по виду.
 *
 * Высота по умолчанию h-9 — как у Input и Button. Плотный вариант на одну
 * ступень ниже задаёт вызывающая сторона через className, внутри примитива его нет.
 */
function NativeSelect({ className, ...props }) {
  return (
    <select
      data-slot="native-select"
      className={cn(
        'border-input focus-visible:border-ring focus-visible:ring-ring/50 dark:bg-input/30 h-9 w-full rounded-md border bg-transparent px-2 text-sm shadow-xs transition-[color,box-shadow] outline-none focus-visible:ring-[3px] disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      {...props}
    />
  );
}

export { NativeSelect };
