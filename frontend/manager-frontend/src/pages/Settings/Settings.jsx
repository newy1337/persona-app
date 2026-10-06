import { useCallback, useEffect, useState } from 'react';
import { X } from 'lucide-react';
import Header from '../../components/Header/Header';
import { getSettings, updateSettings } from '../../api/settings';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';

export const MAX_TRIGGERS = 200;

/** Список без пустых строк и дублей (регистр, ё/е и пробелы не считаются). */
export function cleanTriggers(list) {
  const seen = new Set();
  const out = [];
  for (const item of list) {
    const text = String(item ?? '').replace(/\s+/g, ' ').trim();
    const key = text.toLowerCase().replace(/ё/g, 'е');
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(text);
  }
  return out.slice(0, MAX_TRIGGERS);
}

export function TriggersEditor({ initial, onSave }) {
  const [draft, setDraft] = useState(initial.length ? initial : ['']);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [savedAt, setSavedAt] = useState(null);

  useEffect(() => {
    setDraft(initial.length ? initial : ['']);
  }, [initial]);

  const cleaned = cleanTriggers(draft);
  const dirty = JSON.stringify(cleaned) !== JSON.stringify(initial);

  const change = (i, value) => setDraft((r) => r.map((x, j) => (j === i ? value : x)));
  const remove = (i) => setDraft((r) => (r.length > 1 ? r.filter((_, j) => j !== i) : ['']));
  const add = () => setDraft((r) => [...r, '']);

  async function save(e) {
    e.preventDefault();
    if (busy || !dirty) return;
    setBusy(true);
    setError(null);
    try {
      await onSave(cleaned);
      setSavedAt(Date.now());
    } catch (err) {
      setError(err.detail || err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="flex flex-col gap-3" onSubmit={save} aria-label="Стоп-фразы">
      <ol className="flex list-decimal flex-col gap-1.5 pl-6 marker:text-xs marker:text-muted-foreground">
        {draft.map((value, i) => (
          <li key={i} className="flex items-center gap-2 pl-1">
            <Input
              className="flex-1"
              value={value}
              placeholder="например: позови менеджера"
              maxLength={200}
              disabled={busy}
              aria-label={`Стоп-фраза ${i + 1}`}
              onChange={(e) => change(i, e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && i === draft.length - 1 && value.trim()) {
                  e.preventDefault();
                  add();
                }
              }}
            />
            <Button
              type="button"
              variant="ghost"
              size="icon"
              disabled={busy}
              onClick={() => remove(i)}
              aria-label={`Удалить стоп-фразу ${i + 1}`}
            >
              <X />
            </Button>
          </li>
        ))}
      </ol>
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" variant="outline" disabled={busy || draft.length >= MAX_TRIGGERS} onClick={add}>
          + Добавить фразу
        </Button>
        <Button type="submit" disabled={busy || !dirty}>
          {busy ? 'Сохраняем…' : 'Сохранить'}
        </Button>
        <span className="min-w-[26ch] text-xs text-muted-foreground tabular-nums" role="status">
          {error ? '' : dirty ? 'есть несохранённые изменения' : savedAt ? 'сохранено' : `${cleaned.length} фраз`}
        </span>
      </div>
      <div className="min-h-5 text-sm text-destructive">
        {error && <p role="alert">{error}</p>}
      </div>
    </form>
  );
}

function TriggersSkeleton() {
  return (
    <div className="flex flex-col gap-3" role="status" aria-label="Загружаем…">
      <div className="flex flex-col gap-1.5 pl-7">
        <Skeleton className="h-9 w-full" />
        <Skeleton className="h-9 w-full" />
        <Skeleton className="h-9 w-full" />
      </div>
      <div className="flex gap-2">
        <Skeleton className="h-9 w-40" />
        <Skeleton className="h-9 w-28" />
      </div>
    </div>
  );
}

export default function Settings() {
  const [settings, setSettings] = useState(null);
  const [error, setError] = useState(null);

  const load = useCallback(() => {
    getSettings().then(setSettings).catch((e) => setError(e.detail || e.message));
  }, []);
  useEffect(() => { load(); }, [load]);

  const triggers = settings?.handoff_triggers ?? [];

  return (
    <div className="app">
      <Header />
      <main className="main">
        <div className="container">
          <div className="my-6 flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-xl font-semibold">Настройки</h2>
          </div>
          <div className="min-h-5 text-sm text-destructive">{error && <p>{error}</p>}</div>

          <section className="max-w-[720px] pt-2">
            <h3 className="text-sm font-medium">Стоп-фразы: передать менеджеру</h3>
            <p className="mt-1.5 mb-4 text-xs leading-relaxed text-muted-foreground">
              Если клиент написал что-то из этого списка, бот сразу замолкает, чат уходит в очередь
              «ждут менеджера» с пометкой «Стоп-фраза клиента». Фраза ищется внутри сообщения:
              регистр, буква ё и пробелы не важны, другие окончания подходят («менеджерка» для
              «менеджер»), опечатки прощаются — одна в словах из 5–6 букв, две в более длинных,
              слова короче 5 букв только точно. Вернуть бота — кнопкой «Продолжить» в диалоге.
            </p>
            {settings ? (
              <TriggersEditor
                initial={triggers}
                onSave={async (list) => setSettings(await updateSettings({ handoff_triggers: list }))}
              />
            ) : (
              !error && <TriggersSkeleton />
            )}
          </section>
        </div>
      </main>
    </div>
  );
}
