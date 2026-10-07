import { useCallback, useEffect, useState } from 'react';
import { Plus, X } from 'lucide-react';
import { getSettings, updateSettings } from '../../api/settings';
import { useRouteBusy } from '@/components/AppLayout/routeBusy';
import { IconAction } from '@/components/IconAction/IconAction';
import { PageHeader } from '@/components/PageHeader/PageHeader';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Separator } from '@/components/ui/separator';
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

const FORM = 'flex flex-col gap-3';
const LIST = 'flex list-none flex-col gap-1.5';
const ROW = 'flex items-center gap-2';
const FOOTER = 'flex flex-wrap items-center gap-3';

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
    <form className={FORM} onSubmit={save} aria-label="Стоп-фразы">
      <ol className={LIST}>
        {draft.map((value, i) => (
          <li key={i} className={ROW}>
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
            <IconAction
              icon={X}
              label={`Удалить стоп-фразу ${i + 1}`}
              hint="Удалить"
              tone="danger"
              disabled={busy}
              onClick={() => remove(i)}
            />
          </li>
        ))}
      </ol>
      <Button
        type="button"
        variant="ghost"
        className="self-start text-muted-foreground"
        disabled={busy || draft.length >= MAX_TRIGGERS}
        onClick={add}
      >
        <Plus aria-hidden="true" />
        Добавить фразу
      </Button>
      <Separator />
      <div className={FOOTER}>
        <Button type="submit" className="min-w-28" disabled={busy || !dirty}>
          {busy ? 'Сохраняем…' : 'Сохранить'}
        </Button>
        <span className="min-w-[26ch] text-xs text-muted-foreground tabular-nums" role="status">
          {error ? '' : dirty ? 'есть несохранённые изменения' : savedAt ? 'сохранено' : `${cleaned.length} фраз`}
        </span>
      </div>
      <div className="min-h-4 text-xs text-destructive">
        {error && <p role="alert">{error}</p>}
      </div>
    </form>
  );
}

// Заглушка собрана из тех же рядов, что и форма: высоты совпадают по построению.
function TriggersSkeleton() {
  return (
    <div className={FORM} role="status" aria-label="Загружаем…">
      <div className={LIST}>
        {[0, 1, 2].map((i) => (
          <div key={i} className={ROW}>
            <Skeleton className="h-8 flex-1" />
            <Skeleton className="size-8 shrink-0" />
          </div>
        ))}
      </div>
      <Skeleton className="h-8 w-36" />
      <Separator />
      <div className={FOOTER}>
        <Skeleton className="h-8 w-28" />
      </div>
      <div className="min-h-4" />
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
  useRouteBusy(!settings && !error);

  const triggers = settings?.handoff_triggers ?? [];

  return (
    <div className="container pb-8">
      <PageHeader title="Настройки" />

      {/* Одна колонка: разделы идут друг за другом, внутри раздела — линия перед действиями. */}
      <div className="flex max-w-2xl flex-col gap-4">
        <p className="min-h-4 text-xs text-destructive" role="status">{error}</p>

        <section className="flex flex-col gap-4" aria-labelledby="settings-triggers">
          <div className="flex flex-col gap-1">
            <h2 id="settings-triggers" className="text-sm font-medium">Стоп-фразы: передать менеджеру</h2>
            <p className="text-xs leading-relaxed text-muted-foreground">
              Если клиент написал что-то из этого списка, бот сразу замолкает, чат уходит в очередь
              «ждут менеджера» с пометкой «Стоп-фраза клиента». Фраза ищется внутри сообщения:
              регистр, буква ё и пробелы не важны, другие окончания подходят («менеджерка» для
              «менеджер»), опечатки прощаются — одна в словах из 5–6 букв, две в более длинных,
              слова короче 5 букв только точно. Вернуть бота — кнопкой «Продолжить» в диалоге.
            </p>
          </div>
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
    </div>
  );
}
