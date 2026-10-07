import { Slot } from '@radix-ui/react-slot';
import { cva } from 'class-variance-authority';
import { cn } from '@/lib/utils';

/**
 * Соответствие кнопок из SCSS-модулей страниц вариантам этого примитива:
 *   s.btn               -> variant="outline"
 *   s.btnPrimary        -> variant="default"
 *   s.btnGhost          -> variant="ghost"
 *   s.btnDanger (в строке таблицы) -> variant="ghost" + className="text-destructive"
 *   необратимое подтверждение      -> variant="destructive"
 *   s.btnSelected       -> variant="secondary" + aria-pressed
 * Высота одна на всю панель — 32px: default и sm совпадают (sm оставлен как
 * псевдоним), lg — 36px для редких крупных действий, xs — 28px для плотных
 * строк таблиц и инлайн-действий (text-xs).
 * icon / icon-sm — квадратные кнопки-иконки 32px, icon-xs — 28px (см. IconAction).
 * outline — плоская: прозрачный фон, рамка border-input, без тени.
 */
const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-all disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-4 shrink-0 [&_svg]:shrink-0 outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]",
  {
    variants: {
      variant: {
        default: 'bg-primary text-primary-foreground shadow-xs hover:bg-primary/90',
        destructive:
          'bg-destructive text-white shadow-xs hover:bg-destructive/90 focus-visible:ring-destructive/20',
        outline:
          'border border-input bg-transparent hover:bg-accent hover:text-accent-foreground',
        secondary: 'bg-secondary text-secondary-foreground shadow-xs hover:bg-secondary/80',
        ghost: 'hover:bg-accent hover:text-accent-foreground dark:hover:bg-accent/50',
        link: 'text-primary underline-offset-4 hover:underline',
      },
      size: {
        default: 'h-8 gap-1.5 px-3 has-[>svg]:px-2.5',
        xs: "h-7 rounded-md gap-1 px-2 text-xs has-[>svg]:px-1.5 [&_svg:not([class*='size-'])]:size-3.5",
        sm: 'h-8 gap-1.5 px-3 has-[>svg]:px-2.5',
        lg: 'h-9 px-4 has-[>svg]:px-3',
        icon: 'size-8',
        'icon-sm': 'size-8',
        'icon-xs': "size-7 [&_svg:not([class*='size-'])]:size-3.5",
      },
    },
    defaultVariants: { variant: 'default', size: 'default' },
  },
);

function Button({ className, variant, size, asChild = false, ...props }) {
  const Comp = asChild ? Slot : 'button';
  return (
    <Comp
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  );
}

export { Button, buttonVariants };
