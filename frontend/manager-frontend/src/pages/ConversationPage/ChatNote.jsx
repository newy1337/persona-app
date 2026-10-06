import { useEffect, useRef, useState } from 'react';
import { Plus } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';

const when = (ts) => (ts ? new Date(ts * 1000).toLocaleString('ru-RU', { timeZone: 'Europe/Moscow', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '');

/* Секция сайдбара: без своей рамки и фона, границы даёт divide-y колонки. */
const block = cn('summarySection', 'shrink-0');

export default function ChatNote({ note, noteBy, noteAt, onSave }) {
  const [text, setText] = useState(note ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [open, setOpen] = useState(Boolean(note));
  const saved = useRef(note ?? '');

  useEffect(() => {
    const incoming = note ?? '';
    if (incoming === saved.current) return;
    saved.current = incoming;
    setText(incoming);
    if (incoming) setOpen(true);
  }, [note]);

  const dirty = text !== (note ?? '');

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await onSave(text);
      saved.current = text.trim();
    } catch (e) {
      setError(e.detail || e.message);
    } finally {
      setBusy(false);
    }
  };

  if (!open) {
    return (
      <section className={cn(block, 'px-2.5 py-2')}>
        <Button
          variant="ghost"
          size="sm"
          className="w-full justify-start font-normal text-muted-foreground"
          onClick={() => setOpen(true)}
          data-testid="note-add"
        >
          <Plus aria-hidden="true" />
          Заметка о диалоге
        </Button>
      </section>
    );
  }

  return (
    <section className={cn(block, 'flex flex-col gap-3 px-5 py-4')}>
      <div className="flex min-h-5 items-center justify-between gap-2">
        <h3 className="text-sm font-medium">Заметка</h3>
        {noteAt && (
          <span className="min-w-0 truncate text-xs text-muted-foreground tabular-nums">
            {noteBy ? `${noteBy}, ` : ''}{when(noteAt)}
          </span>
        )}
      </div>
      <div className="flex flex-col gap-2">
        <Textarea
          className="min-h-[88px] resize-y [field-sizing:fixed]"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Что помнить про этот диалог. Бот это не читает."
          rows={4}
          maxLength={4000}
          data-testid="note-text"
        />
        <div className="flex min-h-8 items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            className="min-w-[104px]"
            onClick={save}
            disabled={busy || !dirty}
            data-testid="note-save"
          >
            {busy ? 'Сохраняю…' : dirty ? 'Сохранить' : 'Сохранено'}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="text-muted-foreground"
            onClick={() => setText('')}
            disabled={busy || !text}
            data-testid="note-clear"
            title="Очистить и сохранить пустую — заметка удалится"
          >
            Очистить
          </Button>
          {error && (
            <p role="alert" title={error} className="line-clamp-2 min-w-0 flex-1 text-xs leading-4 text-destructive">
              {error}
            </p>
          )}
        </div>
      </div>
    </section>
  );
}
