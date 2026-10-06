import { useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';

const when = (ts) => (ts ? new Date(ts * 1000).toLocaleString('ru-RU', { timeZone: 'Europe/Moscow', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '');

const card = cn('summarySection', 'shrink-0 gap-0 rounded-lg py-0 shadow-none');

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
      <Card className={card}>
        <Button
          variant="ghost"
          size="sm"
          className="h-10 w-full justify-start rounded-lg px-4 font-normal text-muted-foreground"
          onClick={() => setOpen(true)}
          data-testid="note-add"
        >
          + Заметка о диалоге
        </Button>
      </Card>
    );
  }

  return (
    <Card className={card}>
      <div className="flex min-h-10 items-center justify-between gap-2 border-b px-4 py-2">
        <span className="text-sm font-semibold">Заметка</span>
        {noteAt && (
          <Badge
            variant="outline"
            className="h-5 min-w-0 shrink rounded-full font-mono font-normal text-muted-foreground tabular-nums"
          >
            <span className="truncate">{noteBy ? `${noteBy}, ` : ''}{when(noteAt)}</span>
          </Badge>
        )}
      </div>
      <div className="flex flex-col gap-2 p-4">
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
            variant={dirty ? 'default' : 'outline'}
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
    </Card>
  );
}
