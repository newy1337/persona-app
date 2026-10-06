import { cn } from '@/lib/utils';
import { Label } from './label';

/**
 * Подпись + контрол + строка подсказки/ошибки. Label ОБОРАЧИВАЕТ контрол
 * (тесты VoiceWork/TaskChat/Managers/Leads ищут input внутри label), а
 * нижняя строка всегда занимает min-h-4, чтобы форма не прыгала, когда
 * появляется или исчезает ошибка.
 */
function Field({ label, hint, error, className, children, ...props }) {
  return (
    <Label
      data-slot="field"
      className={cn('flex flex-col items-stretch gap-1.5 text-xs text-muted-foreground', className)}
      {...props}
    >
      {label}
      {children}
      <span
        data-slot="field-message"
        className={cn('min-h-4 text-xs', error ? 'text-destructive' : 'text-muted-foreground')}
      >
        {error || hint}
      </span>
    </Label>
  );
}

export { Field };
