import { History, Undo2 } from 'lucide-react';
import { HelpHint } from '@/components/HelpHint/HelpHint';
import { IconAction } from '@/components/IconAction/IconAction';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { ago } from './Versions';

// Статус — точка нужного тона и нейтральный текст, без цветных строк.
const DOT = "inline-flex items-center gap-1.5 before:size-1.5 before:shrink-0 before:rounded-full before:content-['']";

/**
 * Верхняя полоса редактора секции: слева необязательный переключатель
 * (leading) и сводка, справа — действия секции (children) и два общих для всех
 * секций действия-иконки: история версий и отмена правок. Пояснение к секции
 * (help) спрятано за значком «?» рядом со сводкой. Под полосой — фиксированная
 * строка под заметку о черновике: она занимает место всегда, чтобы редактор
 * не прыгал, когда черновик появляется.
 */
export function EditorBar({ leading, summary, help, helpLabel, draftAt, dirty, versions, onReset, children }) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex min-h-8 flex-wrap items-center gap-2">
        {leading}
        <span className="flex min-w-0 items-center gap-1 text-xs text-muted-foreground tabular-nums">
          <span className="min-w-0">{summary}</span>
          {help && <HelpHint label={helpLabel}>{help}</HelpHint>}
        </span>
        <div className="ml-auto flex flex-wrap items-center gap-1">
          {children}
          {versions && (
            <IconAction
              icon={History}
              label={versions.open ? 'Скрыть историю' : 'История версий'}
              aria-pressed={versions.open}
              className="aria-pressed:bg-accent aria-pressed:text-foreground"
              onClick={versions.toggle}
            />
          )}
          {onReset && <IconAction icon={Undo2} label="Отменить правки" disabled={!dirty} onClick={onReset} />}
        </div>
      </div>
      <p className="min-h-4 text-xs text-muted-foreground" role="status">
        {draftAt && dirty && (
          <span className={cn(DOT, 'before:bg-warning-foreground')}>
            Черновик сохранён в браузере ({ago(draftAt)}) — правки не потеряются при перезагрузке.
          </span>
        )}
      </p>
    </div>
  );
}

/**
 * Прилипающая к низу полоса сохранения: статус (резерв min-h), подпись к
 * версии и единственная основная кнопка страницы. Полоса непрозрачная и
 * отделена линией — текст под ней не просвечивает; mt-auto и -mb-4 прижимают
 * её к нижнему краю блока личности, даже когда редактор короче блока.
 */
export function SaveBar({ status, error, note, onNote, onSave, disabled, busy, label, className }) {
  return (
    <div
      className={cn(
        'sticky bottom-0 z-10 -mx-4 mt-auto -mb-4 flex flex-wrap items-center justify-end gap-2 rounded-b-lg border-t bg-card px-4 py-3',
        className,
      )}
    >
      <span
        role="status"
        className={cn(
          'min-h-4 min-w-0 flex-1 basis-full text-xs sm:basis-auto sm:text-right',
          error ? 'text-destructive' : 'text-muted-foreground',
        )}
      >
        {error || (status ? <span className={cn(DOT, 'before:bg-success-foreground')}>{status}</span> : '')}
      </span>
      <Input
        className="max-w-60"
        placeholder="подпись к версии"
        aria-label="Подпись к версии"
        value={note}
        onChange={(e) => onNote(e.target.value)}
      />
      <Button disabled={disabled} onClick={onSave} title="Ctrl+S">
        {busy ? 'Сохранение…' : label}
      </Button>
    </div>
  );
}
