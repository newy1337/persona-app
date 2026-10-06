import { cn } from '@/lib/utils';

/**
 * Обычный <select> в оформлении shadcn. В таблицах их десятки, и на каждой
 * строке поповер Radix стоил бы дороже, чем выигрывает по виду.
 *
 * Системная стрелка убрана, вместо неё — тонкая «галочка» (класс
 * native-select в theme.css), одинаковая во всех браузерах.
 *   variant="default" — поле с рамкой, для форм и тулбаров;
 *   variant="ghost"   — без рамки и фона, для строк таблиц: читается как
 *                       текст со стрелкой и не спорит с соседними ячейками.
 * Высота по умолчанию h-9 — как у Input и Button; плотный вариант (h-8 / h-7)
 * задаёт вызывающая сторона через className.
 */
const variants = {
  default: 'border-input bg-transparent shadow-xs dark:bg-input/30',
  ghost: 'border-transparent bg-transparent hover:bg-accent dark:hover:bg-accent/60',
};

function NativeSelect({ className, variant = 'default', ...props }) {
  return (
    <select
      data-slot="native-select"
      className={cn(
        'native-select h-9 w-full cursor-pointer rounded-md border pr-7 pl-2.5 text-sm transition-[color,box-shadow,background-color] outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40 disabled:cursor-not-allowed disabled:opacity-50',
        variants[variant] ?? variants.default,
        className,
      )}
      {...props}
    />
  );
}

export { NativeSelect };
