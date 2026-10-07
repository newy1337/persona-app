import { CircleHelp } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

/**
 * Пояснение к полю, спрятанное в подсказку: маленький значок «?» рядом с
 * подписью вместо строки текста под полем. Нужен там, где объяснение
 * действительно помогает (что делает настройка), но не должно занимать место.
 *
 * Это <span role="button">, а не <button>: значок часто стоит внутри <label>,
 * а подпись без htmlFor привязывается к первому «подписываемому» потомку —
 * настоящая кнопка отобрала бы подпись у поля.
 */
export function HelpHint({ label, className, children }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          role="button"
          tabIndex={0}
          aria-label={`Пояснение: ${label}`}
          className={cn(
            'grid size-4 shrink-0 cursor-help place-items-center rounded-full text-muted-foreground/60 outline-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50',
            className,
          )}
          // Клик по значку не должен переводить фокус в поле, к которому относится подпись.
          onClick={(e) => e.preventDefault()}
        >
          <CircleHelp className="size-3.5" aria-hidden="true" />
        </span>
      </TooltipTrigger>
      <TooltipContent className="max-w-xs text-left text-pretty">{children}</TooltipContent>
    </Tooltip>
  );
}
