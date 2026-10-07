import { useEffect, useRef, useState } from 'react';
import * as PopoverPrimitive from '@radix-ui/react-popover';
import { Pencil } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent } from '@/components/ui/popover';

/**
 * Значение, которое правится на месте. Обе формы — кнопка и поле — занимают
 * одну и ту же строку высотой h-7 и наследуют размер шрифта строки, поэтому
 * вход в правку не двигает соседей.
 * Ошибка сохранения показывается во всплывающем слое (портал): её не обрежет
 * ни один родитель с overflow, и места в потоке она не занимает.
 * Кольцо фокуса рисуется внутри кнопки (ring-inset) — его тоже нечем обрезать.
 * `label` — подпись строки: из неё собирается aria-label кнопки и поля.
 * Что значение можно править, видно сразу: под ним пунктирная линия, рядом
 * карандаш (он на месте всегда, не только при наведении). Пустое значение
 * читается как «добавить». Обычный текст без правки этих примет не несёт.
 */
export const EMPTY_LABEL = 'добавить';

export default function EditableValue({ value, display, placeholder = EMPTY_LABEL, title, label, onSave }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(value ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const input = useRef(null);

  useEffect(() => {
    if (!editing) setText(value ?? '');
  }, [value, editing]);

  useEffect(() => {
    if (editing) input.current?.focus();
  }, [editing]);

  // На время сохранения поле отключено и теряет фокус; после сбоя возвращаем
  // его, чтобы можно было поправить значение или выйти по Esc. Если человек
  // уже перешёл в другое поле (например, пишет сообщение) — не мешаем.
  useEffect(() => {
    if (!error) return;
    const active = document.activeElement;
    if (!active || active === document.body) input.current?.focus();
  }, [error]);

  async function save() {
    if (busy) return;
    if (String(text).trim() === String(value ?? '').trim()) {
      setEditing(false);
      setError(null);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await onSave(String(text).trim());
      setEditing(false);
    } catch (e) {
      setError(e.detail || e.message);
    } finally {
      setBusy(false);
    }
  }

  if (!editing) {
    const shown = display || value || placeholder;
    const empty = !display && !value;
    return (
      <button
        type="button"
        data-empty={empty ? '' : undefined}
        className="-mx-1.5 inline-flex h-7 max-w-[calc(100%+0.75rem)] min-w-0 cursor-pointer items-center gap-1.5 rounded-sm px-1.5 text-left align-middle outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:ring-inset"
        title={title ?? 'Нажмите, чтобы поправить — бот узнает это как факт'}
        aria-label={label && typeof shown === 'string' ? `${label}: ${shown}` : undefined}
        onClick={(e) => {
          e.stopPropagation();
          setEditing(true);
        }}
      >
        {/* Линия стоит под самим значением (не под всей строкой): строки карточки
            не превращаются в разлинованную таблицу. */}
        <span
          className={cn(
            'min-w-0 truncate border-b border-dashed border-input leading-5',
            !value && 'text-muted-foreground',
          )}
        >
          {shown}
        </span>
        <Pencil aria-hidden="true" className="size-3 shrink-0 text-muted-foreground/70" />
      </button>
    );
  }

  return (
    <Popover open={Boolean(error)}>
      <PopoverPrimitive.Anchor asChild>
        <span
          className="inline-flex h-7 w-full max-w-full min-w-0 items-center align-middle"
          onClick={(e) => e.stopPropagation()}
        >
          <Input
            ref={input}
            className="h-7 min-w-[90px] rounded-sm px-1.5 py-0 text-[length:inherit] focus-visible:ring-2 focus-visible:ring-inset md:text-[length:inherit]"
            value={text}
            disabled={busy}
            placeholder="пусто — снять"
            aria-label={label}
            aria-invalid={error ? true : undefined}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void save();
              if (e.key === 'Escape') {
                setEditing(false);
                setError(null);
              }
            }}
            onBlur={() => void save()}
          />
        </span>
      </PopoverPrimitive.Anchor>
      {/* Фокус остаётся в поле: слой с ошибкой его не забирает и не возвращает. */}
      <PopoverContent
        role="alert"
        side="bottom"
        className="w-auto max-w-[min(18rem,calc(100vw-2rem))] px-2.5 py-1.5 text-xs leading-4 text-destructive [overflow-wrap:anywhere]"
        onOpenAutoFocus={(e) => e.preventDefault()}
        onCloseAutoFocus={(e) => e.preventDefault()}
        onClick={(e) => e.stopPropagation()}
      >
        {error}
      </PopoverContent>
    </Popover>
  );
}
