import { Slot } from '@radix-ui/react-slot';
import { cva } from 'class-variance-authority';
import { cn } from '@/lib/utils';

/**
 * Статусные варианты (success / warning / destructive) — нейтральный текст и
 * цветная точка слева, без заливки: цвет несёт смысл, но не спорит с остальным
 * интерфейсом. default — мягкая синяя подложка для единственной выделенной
 * метки в блоке; secondary и outline — нейтральные. Цвета стадий диалогов
 * приходят из data/stages.js и выводятся такой же точкой.
 */
const DOT =
  "gap-1.5 text-foreground before:size-1.5 before:shrink-0 before:rounded-full before:content-['']";

const badgeVariants = cva(
  'inline-flex items-center justify-center rounded-md border px-2 py-0.5 text-xs font-medium w-fit whitespace-nowrap shrink-0 gap-1 [&>svg]:size-3 transition-[color,box-shadow] overflow-hidden',
  {
    variants: {
      variant: {
        default: 'border-primary/30 bg-primary/10 text-foreground',
        secondary: 'border-transparent bg-secondary text-secondary-foreground',
        destructive: `${DOT} before:bg-destructive`,
        success: `${DOT} before:bg-success-foreground`,
        warning: `${DOT} before:bg-warning-foreground`,
        outline: 'text-foreground',
      },
    },
    defaultVariants: { variant: 'default' },
  },
);

function Badge({ className, variant, asChild = false, ...props }) {
  const Comp = asChild ? Slot : 'span';
  return (
    <Comp data-slot="badge" className={cn(badgeVariants({ variant }), className)} {...props} />
  );
}

export { Badge, badgeVariants };
