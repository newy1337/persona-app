import { useCallback, useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { PanelUX as ux } from '../../ui/PanelUX';
import { createDonor, deleteDonor, getDonors } from '../../api/donors';
import { createSource, deleteSource, getSources } from '../../api/sources';
import { PageHeader } from '@/components/PageHeader/PageHeader';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';

/** Один справочник: список с числом менеджеров, добавить, удалить. */
export function CatalogPanel({ title, hint, placeholder, items, onCreate, onDelete, onError, deleteNote }) {
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  async function add(e) {
    e.preventDefault();
    if (!name.trim() || busy) return;
    setBusy(true);
    try { await onCreate(name.trim()); setName(''); }
    catch (err) { onError(ux.readableError(err)); }
    finally { setBusy(false); }
  }
  async function remove(item) {
    if (!await ux.confirm({ title: `Удалить «${item.name}»?`, message: item.managers ? deleteNote(item.managers) : 'Никому не назначен.', confirmLabel: 'Удалить', danger: true })) return;
    try { await onDelete(item.id); }
    catch (err) { onError(ux.readableError(err)); }
  }
  return (
    <Card className="mb-4 gap-3 p-4" aria-label={title}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-base font-semibold">{title} <span className="font-normal text-muted-foreground">· {items.length}</span></h2>
        <form className="flex flex-wrap items-center gap-2" onSubmit={add} aria-label={`Добавить: ${title}`}>
          <Input className="w-56" value={name} maxLength={64} placeholder={placeholder} aria-label={`Новый: ${title}`} disabled={busy} onChange={(e) => setName(e.target.value)} />
          <Button type="submit" disabled={!name.trim() || busy}>Добавить</Button>
        </form>
      </div>
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      {items.length === 0 ? <p className="text-sm text-muted-foreground">Пока пусто.</p> : (
        <ul className="flex flex-wrap gap-2">
          {items.map((item) => (
            <li key={item.id} className="inline-flex items-center gap-2 rounded-md border py-1 pr-1 pl-2.5 text-sm" data-item-id={item.id}>
              <span className="font-medium">{item.name}</span>
              <span className="text-xs text-muted-foreground">{item.managers ? `${item.managers} менедж.` : 'не назначен'}</span>
              <Button type="button" variant="ghost" size="icon-xs" className="text-muted-foreground hover:text-destructive" onClick={() => remove(item)} aria-label={`Удалить ${item.name}`} title="Удалить">
                <X aria-hidden="true" />
              </Button>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

export default function Catalogs() {
  const [donors, setDonors] = useState([]);
  const [sources, setSources] = useState([]);
  const [error, setError] = useState('');
  const load = useCallback(async () => {
    const [d, src] = await Promise.all([getDonors(), getSources()]);
    setDonors(d.items ?? []);
    setSources(src.items ?? []);
  }, []);
  useEffect(() => { load().catch((e) => setError(ux.readableError(e))); }, [load]);
  return (
    <div className="container">
      <PageHeader title="Справочники" />
      {error && <p className="mb-3 text-sm text-destructive" role="alert">{error}</p>}
      <CatalogPanel
        title="Доноры"
        placeholder="Например, camp-42"
        items={donors}
        onError={setError}
        onCreate={async (name) => { setDonors((await createDonor(name)).items ?? []); setError(''); }}
        onDelete={async (id) => { setDonors((await deleteDonor(id)).items ?? []); setError(''); }}
        deleteNote={(n) => `Он отвяжется у ${n} менедж.`}
      />
      <CatalogPanel
        title="Источники"
        placeholder="Например, beboo"
        items={sources}
        onError={setError}
        onCreate={async (name) => { setSources((await createSource(name)).items ?? []); setError(''); }}
        onDelete={async (id) => { setSources((await deleteSource(id)).items ?? []); setError(''); }}
        deleteNote={(n) => `Он снимется у ${n} менедж.`}
      />
    </div>
  );
}
