import { useEffect, useState } from 'react';
import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react';
import { useRouteBusy } from '@/components/AppLayout/routeBusy';
import { IconAction } from '@/components/IconAction/IconAction';
import { PageHeader } from '@/components/PageHeader/PageHeader';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { getQuickReplies, putQuickReplies } from '../../api/quickReplies';

// Шаблоны ответов команды: менеджер вставляет их в чат кнопкой у поля ответа.
// Список правится целиком и сохраняется одной кнопкой; {name} — имя собеседника.
const blank = () => ({ title: '', text: '' });

export default function QuickReplies() {
  const [items, setItems] = useState(null);
  const [saved, setSaved] = useState('[]');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [flash, setFlash] = useState(null);
  useRouteBusy(items === null && !error);

  useEffect(() => {
    getQuickReplies({ fresh: true })
      .then((list) => {
        setItems(list);
        setSaved(JSON.stringify(list));
      })
      .catch((e) => setError(e.detail || e.message));
  }, []);

  const dirty = items !== null && JSON.stringify(items) !== saved;
  const invalid = (items ?? []).some((i) => !i.title.trim() || !i.text.trim());
  const set = (i, patch) => {
    setFlash(null);
    setItems((cur) => cur.map((it, k) => (k === i ? { ...it, ...patch } : it)));
  };
  const move = (i, delta) =>
    setItems((cur) => {
      const next = [...cur];
      [next[i], next[i + delta]] = [next[i + delta], next[i]];
      return next;
    });

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const list = await putQuickReplies(items);
      setItems(list);
      setSaved(JSON.stringify(list));
      setFlash('Сохранено — менеджеры увидят шаблоны при следующем открытии чата');
    } catch (e) {
      setError(e.detail || e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="container pb-8">
      <PageHeader title="Шаблоны ответов" description="Готовые фразы для менеджеров: вставляются в чат кнопкой у поля ответа. {name} заменится именем собеседника.">
        <Button variant="outline" onClick={() => setItems((cur) => [...(cur ?? []), blank()])} disabled={items === null}>
          <Plus aria-hidden="true" />
          Добавить шаблон
        </Button>
      </PageHeader>

      <div className="flex max-w-3xl flex-col gap-3">
        {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
        {items === null && !error && [0, 1, 2].map((i) => <Skeleton key={i} className="h-28 w-full rounded-lg" />)}
        {items?.length === 0 && (
          <div className="rounded-lg border border-dashed px-6 py-10 text-center text-sm text-muted-foreground">
            Шаблонов пока нет. Добавьте первый — например, «Напишу чуть позже» или «Привет, {'{name}'}!».
          </div>
        )}
        {items?.map((it, i) => (
          <section key={i} className="flex flex-col gap-2 rounded-lg border bg-card p-3" data-testid="reply-template">
            <div className="flex items-center gap-2">
              <Input
                aria-label={`Название шаблона ${i + 1}`}
                placeholder="Короткое название — по нему ищут"
                maxLength={60}
                value={it.title}
                aria-invalid={!it.title.trim() || undefined}
                onChange={(e) => set(i, { title: e.target.value })}
              />
              <IconAction icon={ArrowUp} label="Выше" disabled={i === 0} onClick={() => move(i, -1)} />
              <IconAction icon={ArrowDown} label="Ниже" disabled={i === items.length - 1} onClick={() => move(i, 1)} />
              <IconAction icon={Trash2} label="Удалить шаблон" tone="danger" onClick={() => setItems((cur) => cur.filter((_, k) => k !== i))} />
            </div>
            <Textarea
              aria-label={`Текст шаблона ${i + 1}`}
              placeholder="Текст, который вставится в поле ответа"
              rows={2}
              maxLength={1000}
              value={it.text}
              aria-invalid={!it.text.trim() || undefined}
              onChange={(e) => set(i, { text: e.target.value })}
            />
          </section>
        ))}
        <div className="flex items-center justify-end gap-3">
          <span className="text-xs text-muted-foreground" role="status">
            {invalid ? 'У каждого шаблона нужны название и текст' : flash}
          </span>
          <Button onClick={save} disabled={!dirty || invalid || busy}>
            {busy ? 'Сохраняю…' : 'Сохранить шаблоны'}
          </Button>
        </div>
      </div>
    </div>
  );
}
