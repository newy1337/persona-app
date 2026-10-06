import { useEffect, useRef, useState } from 'react';
import { Pencil } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Input } from '@/components/ui/input';

/**
 * Значение, которое правится на месте. Обе формы — кнопка и поле — занимают
 * одну и ту же строку высотой h-6, поэтому вход в правку не двигает соседей;
 * ошибка сохранения всплывает под полем и места в потоке не занимает.
 * `label` — подпись строки: из неё собирается aria-label кнопки и поля.
 */
export default function EditableValue({ value, display, placeholder = '—', title, label, onSave }) {
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

  async function save() {
    if (busy) return;
    if (String(text).trim() === String(value ?? '').trim()) {
      setEditing(false);
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
    const shown = display ?? (value || placeholder);
    return (
      <button
        type="button"
        className="group/ev inline-flex min-h-6 max-w-full min-w-0 cursor-pointer items-center gap-1.5 rounded-sm text-left align-middle outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
        title={title ?? 'Нажмите, чтобы поправить — бот узнает это как факт'}
        aria-label={label && typeof shown === 'string' ? `${label}: ${shown}` : undefined}
        onClick={(e) => {
          e.stopPropagation();
          setEditing(true);
        }}
      >
        <span className={cn('min-w-0 truncate', !value && 'text-muted-foreground')}>{shown}</span>
        <Pencil
          aria-hidden="true"
          className="size-3 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover/ev:opacity-100 group-focus-visible/ev:opacity-100"
        />
      </button>
    );
  }

  return (
    <span
      className="relative inline-flex h-6 w-full max-w-full min-w-0 items-center align-middle"
      onClick={(e) => e.stopPropagation()}
    >
      <Input
        ref={input}
        className="h-6 min-w-[90px] rounded-sm px-1.5 py-0 text-xs md:text-xs"
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
      {error && (
        <span
          role="alert"
          className="absolute top-full left-0 z-10 mt-0.5 max-w-full rounded-sm border bg-popover px-1.5 py-0.5 text-[11px] leading-4 text-destructive shadow-md"
        >
          {error}
        </span>
      )}
    </span>
  );
}
