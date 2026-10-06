import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { ago } from './Versions';

/**
 * Верхняя полоса редактора секции: слева необязательный переключатель
 * (leading) и сводка, справа — плотный ряд кнопок size=sm. Под полосой —
 * подсказка и фиксированная строка под заметку о черновике: она занимает
 * место всегда, чтобы редактор не прыгал, когда черновик появляется.
 */
export function EditorBar({ leading, summary, hint, draftAt, dirty, children }) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        {leading}
        <span className="min-w-0 text-xs text-muted-foreground tabular-nums">{summary}</span>
        <div className="ml-auto flex flex-wrap items-center gap-2">{children}</div>
      </div>
      {hint && <p className="text-xs leading-relaxed text-muted-foreground">{hint}</p>}
      <p className="min-h-4 text-xs text-warning-foreground" role="status">
        {draftAt && dirty
          ? `Черновик сохранён в браузере (${ago(draftAt)}) — правки не потеряются при перезагрузке.`
          : ''}
      </p>
    </div>
  );
}

/**
 * Прилипающая к низу полоса сохранения: статус (резерв min-h), подпись к
 * версии и единственная основная кнопка. Градиент от bg-card прячет
 * проезжающий под ней текст.
 */
export function SaveBar({ status, error, note, onNote, onSave, disabled, busy, label, className }) {
  return (
    <div
      className={cn(
        'sticky bottom-0 z-10 -mx-4 flex flex-wrap items-center justify-end gap-2 bg-linear-to-t from-card from-60% to-transparent px-4 py-3',
        className,
      )}
    >
      <span
        role="status"
        className={cn(
          'min-h-4 min-w-0 flex-1 basis-full text-xs sm:basis-auto sm:text-right',
          error ? 'text-destructive' : 'text-success-foreground',
        )}
      >
        {error || status || ''}
      </span>
      <Input
        className="max-w-60"
        placeholder="подпись к версии"
        value={note}
        onChange={(e) => onNote(e.target.value)}
      />
      <Button disabled={disabled} onClick={onSave} title="Ctrl+S">
        {busy ? 'Сохранение…' : label}
      </Button>
      <kbd className="hidden h-5 items-center rounded border bg-muted px-1.5 font-mono text-[10px] text-muted-foreground sm:inline-flex">
        Ctrl+S
      </kbd>
    </div>
  );
}
