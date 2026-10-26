import { useEffect, useMemo, useState } from 'react';
import { MessageSquareQuote } from 'lucide-react';
import { IconAction } from '@/components/IconAction/IconAction';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { fillTemplate, getQuickReplies } from '../../api/quickReplies';

/**
 * Кнопка «Шаблоны» у поля ответа: список готовых фраз команды с поиском.
 * Выбор подставляет текст ({name} — имя собеседника) через onPick; дальше
 * менеджер правит и отправляет как обычно. Шаблоны правят админ и хед в
 * «Настройки → Шаблоны ответов».
 */
export function QuickReplyPicker({ name, onPick, disabled = false, size }) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState(null);
  const [error, setError] = useState(null);
  const [q, setQ] = useState('');

  useEffect(() => {
    if (!open || items) return;
    getQuickReplies()
      .then(setItems)
      .catch((e) => setError(e.detail || e.message));
  }, [open, items]);

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (items ?? []).filter((i) => !needle || i.title.toLowerCase().includes(needle) || i.text.toLowerCase().includes(needle));
  }, [items, q]);

  return (
    <Popover open={open} onOpenChange={(v) => { setOpen(v); if (!v) setQ(''); }}>
      <PopoverTrigger asChild>
        <IconAction icon={MessageSquareQuote} label="Шаблоны ответов" hint="Шаблоны ответов: готовые фразы команды" disabled={disabled} size={size} />
      </PopoverTrigger>
      <PopoverContent align="start" side="top" className="w-80 p-2" data-testid="quick-replies">
        <Input
          autoFocus
          aria-label="Поиск шаблона"
          placeholder="Найти шаблон…"
          className="mb-2 h-8"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && shown[0]) {
              e.preventDefault();
              onPick(fillTemplate(shown[0].text, { name }));
              setOpen(false);
            }
          }}
        />
        <div className="flex max-h-64 flex-col overflow-y-auto">
          {error && <p className="p-2 text-xs text-destructive">{error}</p>}
          {!error && items === null && <p className="p-2 text-xs text-muted-foreground">Загружаю…</p>}
          {items?.length === 0 && <p className="p-2 text-xs text-muted-foreground">Шаблонов пока нет — их добавляют в «Настройки → Шаблоны ответов».</p>}
          {items?.length > 0 && shown.length === 0 && <p className="p-2 text-xs text-muted-foreground">Ничего не нашлось</p>}
          {shown.map((i) => (
            <button
              key={`${i.title}-${i.text}`}
              type="button"
              className="flex flex-col items-start gap-0.5 rounded-md px-2 py-1.5 text-left outline-none hover:bg-accent focus-visible:bg-accent"
              onClick={() => {
                onPick(fillTemplate(i.text, { name }));
                setOpen(false);
              }}
            >
              <span className="text-sm font-medium">{i.title}</span>
              <span className="line-clamp-2 text-xs text-muted-foreground">{fillTemplate(i.text, { name })}</span>
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
