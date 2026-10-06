import { Slot } from '@radix-ui/react-slot';
import { cva } from 'class-variance-authority';
import { cn } from '@/lib/utils';

/**
 * Варианты success / warning опираются на токены --success / --warning из
 * theme.css: приглушённые, с низкой насыщенностью, чтобы не спорить с синим
 * primary. Цвета стадий диалогов сюда не входят — они по-прежнему задаются
 * инлайном через --badge-color / --badge-bg из data/stages.js.
 */
const badgeVariants = cva(
  'inline-flex items-center justify-center rounded-md border px-2 py-0.5 text-xs font-medium w-fit whitespace-nowrap shrink-0 gap-1 [&>svg]:size-3 transition-[color,box-shadow] overflow-hidden',
  {
    variants: {
      variant: {
        default: 'border-transparent bg-primary text-primary-foreground [a&]:hover:bg-primary/90',
        secondary: 'border-transparent bg-secondary text-secondary-foreground',
        destructive: 'border-transparent bg-destructive text-white',
        success: 'border-transparent bg-success text-success-foreground',
        warning: 'border-transparent bg-warning text-warning-foreground',
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
