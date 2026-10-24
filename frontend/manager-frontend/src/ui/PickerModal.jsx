import { useMemo, useState } from 'react';
import { PanelUX as ux } from './PanelUX';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { NativeCheckbox } from '@/components/ui/native-checkbox';

/**
 * Выбор нескольких элементов справочника в попапе: поиск, галочки, «выбрано N».
 * items: [{ id, name }], value: Set(id). onSave(ids[]) — сохранить, onClose — закрыть.
 */
export default function PickerModal({ title, items, value, onSave, onClose, emptyHint = 'Справочник пуст.', anyHint = 'Ничего не выбрано — принимает любые.' }) {
  const [query, setQuery] = useState('');
  const [picked, setPicked] = useState(() => new Set(value));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? items.filter((i) => i.name.toLowerCase().includes(q)) : items;
  }, [items, query]);
  const toggle = (id) => setPicked((was) => { const next = new Set(was); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  const changed = [...picked].sort().join(',') !== [...value].sort().join(',');
  async function save() {
    if (!changed || busy) return;
    setBusy(true); setError('');
    try { await onSave([...picked]); onClose(); }
    catch (e) { setError(ux.readableError(e)); }
    finally { setBusy(false); }
  }
  return (
    <ux.Modal title={title} onClose={onClose} busy={busy} footer={<>
      <Button type="button" variant="outline" disabled={busy} onClick={onClose}>Отмена</Button>
      <Button type="button" disabled={!changed || busy} onClick={save}>{busy ? 'Сохраняем…' : 'Сохранить'}</Button>
    </>}>
      <div className="flex flex-wrap items-center gap-2">
        <Input className="min-w-0 flex-1" type="search" aria-label="Поиск" placeholder="Поиск" value={query} autoFocus onChange={(e) => setQuery(e.target.value)} />
        <span className="text-xs text-muted-foreground tabular-nums">Выбрано: {picked.size}</span>
        {picked.size > 0 && <Button type="button" variant="ghost" size="xs" onClick={() => setPicked(new Set())}>Снять всё</Button>}
      </div>
      <div className="mt-3 grid max-h-[50vh] gap-0.5 overflow-y-auto rounded-md border p-1" role="group" aria-label={title}>
        {items.length === 0 ? <p className="p-2 text-muted-foreground">{emptyHint}</p> : visible.length === 0 ? <p className="p-2 text-muted-foreground">Ничего не найдено.</p> : visible.map((i) => (
          <label key={i.id} className="flex cursor-pointer items-center gap-2.5 rounded-sm px-2 py-1.5 hover:bg-accent">
            <NativeCheckbox checked={picked.has(i.id)} disabled={busy} onChange={() => toggle(i.id)} />
            <span className="min-w-0 flex-1 truncate">{i.name}</span>
            <span className="shrink-0 text-xs text-muted-foreground">{i.note ?? (i.managers != null ? `${i.managers} менедж.` : '')}</span>
          </label>
        ))}
      </div>
      <p className="mt-2.5 text-xs text-muted-foreground">{anyHint}</p>
      {error && <p className="mt-2 text-xs text-destructive" role="alert">{error}</p>}
    </ux.Modal>
  );
}
