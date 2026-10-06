import { cva } from 'class-variance-authority';
import { cn } from '@/lib/utils';

/**
 * Каноническая разметка shadcn: сетка с необязательным слотом под иконку
 * (первый дочерний <svg>), заголовком и описанием во второй колонке.
 * По умолчанию role="status" — сообщение не перебивает чтение экрана;
 * для срочных ошибок передайте role="alert".
 */
const alertVariants = cva(
  'relative grid w-full grid-cols-[0_1fr] items-start gap-y-0.5 rounded-lg border px-4 py-3 text-sm has-[>svg]:grid-cols-[calc(var(--spacing)*4)_1fr] has-[>svg]:gap-x-3 [&>svg]:size-4 [&>svg]:translate-y-0.5 [&>svg]:text-current',
  {
    variants: {
      variant: {
        default: 'bg-card text-card-foreground',
        destructive:
          'bg-card text-destructive border-destructive/30 *:data-[slot=alert-description]:text-destructive/90',
        warning:
          'bg-warning text-warning-foreground border-warning-foreground/20 *:data-[slot=alert-description]:text-warning-foreground/90',
      },
    },
    defaultVariants: { variant: 'default' },
  },
);

function Alert({ className, variant, role = 'status', ...props }) {
  return (
    <div
      data-slot="alert"
      role={role}
      className={cn(alertVariants({ variant }), className)}
      {...props}
    />
  );
}

function AlertTitle({ className, ...props }) {
  return (
    <div
      data-slot="alert-title"
      className={cn('col-start-2 line-clamp-1 min-h-4 font-medium tracking-tight', className)}
      {...props}
    />
  );
}

function AlertDescription({ className, ...props }) {
  return (
    <div
      data-slot="alert-description"
      className={cn(
        'text-muted-foreground col-start-2 grid justify-items-start gap-1 text-sm [&_p]:leading-relaxed',
        className,
      )}
      {...props}
    />
  );
}

export { Alert, AlertTitle, AlertDescription, alertVariants };
