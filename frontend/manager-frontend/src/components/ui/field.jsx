import { cn } from '@/lib/utils';
import { Label } from './label';

/**
 * Подпись + контрол + (необязательная) строка подсказки/ошибки. Label
 * ОБОРАЧИВАЕТ контрол (тесты VoiceWork/TaskChat/Managers/Leads ищут input
 * внутри label).
 *
 * Строка сообщения рисуется только когда есть hint или error, либо когда
 * вызывающая сторона просит reserve — место под сообщение, которое появится
 * позже (ошибка проверки, подсказка после загрузки), чтобы форма не прыгала.
 * Поле без сообщений не держит под собой пустые 16px.
 */
function Field({ label, hint, error, reserve = false, className, children, ...props }) {
  const message = error || hint;
  return (
    <Label
      data-slot="field"
      className={cn(
        'flex flex-col items-stretch gap-1.5 text-xs font-medium text-muted-foreground',
        className,
      )}
      {...props}
    >
      {label}
      {children}
      {(message || reserve) && (
        <span
          data-slot="field-message"
          className={cn(
            'min-h-4 text-xs font-normal',
            error ? 'text-destructive' : 'text-muted-foreground',
          )}
        >
          {message}
        </span>
      )}
    </Label>
  );
}

export { Field };
