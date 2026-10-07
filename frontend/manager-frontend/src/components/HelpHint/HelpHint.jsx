import { CircleHelp } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

/**
 * Пояснение к полю, спрятанное в подсказку: маленький значок «?» рядом с
 * подписью вместо строки текста под полем. Нужен там, где объяснение
 * действительно помогает (что делает настройка), но не должно занимать место.
 */
export function HelpHint({ label, className, children }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={`Пояснение: ${label}`}
          className={cn(
            'grid size-4 shrink-0 place-items-center rounded-full text-muted-foreground/60 outline-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50',
            className,
          )}
          // Значок стоит внутри <label>: клик не должен переводить фокус в поле.
          onClick={(e) => e.preventDefault()}
        >
          <CircleHelp className="size-3.5" aria-hidden="true" />
        </button>
      </TooltipTrigger>
      <TooltipContent className="max-w-xs text-left text-pretty">{children}</TooltipContent>
    </Tooltip>
  );
}
