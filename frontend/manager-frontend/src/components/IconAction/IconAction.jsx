import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

/**
 * Действие-иконка для строк таблиц и тулбаров: квадратная кнопка с подсказкой.
 * label уходит и в aria-label, и в подсказку — действие читается без текста.
 * tone="danger" — для необратимых действий (красный только при наведении).
 */
export function IconAction({
  icon: Icon,
  label,
  hint,
  tone,
  size = 'icon-sm',
  variant = 'ghost',
  className,
  ...props
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant={variant}
          size={size}
          aria-label={label}
          className={cn(
            'text-muted-foreground hover:text-foreground',
            tone === 'danger' && 'hover:bg-destructive/10 hover:text-destructive dark:hover:bg-destructive/15',
            className,
          )}
          {...props}
        >
          <Icon aria-hidden="true" />
        </Button>
      </TooltipTrigger>
      <TooltipContent>{hint ?? label}</TooltipContent>
    </Tooltip>
  );
}
