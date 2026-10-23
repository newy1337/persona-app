import { useCallback, useEffect, useState } from 'react';
import { PanelUX as ux } from '../../ui/PanelUX';
import { createDonor, deleteDonor, getDonors } from '../../api/donors';
import { createSource, deleteSource, getSources } from '../../api/sources';
import s from '../../styles/AdminPage.module.scss';
import './catalogs.css';

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
    <section className="ct-panel" aria-label={title}>
      <div className={s.head}>
        <h3 className={s.title} style={{ fontSize: 16 }}>{title} <span className={s.muted}>· {items.length}</span></h3>
        <form className={s.actions} onSubmit={add} aria-label={`Добавить: ${title}`}>
          <input className={s.field} value={name} maxLength={64} placeholder={placeholder} aria-label={`Новый: ${title}`} disabled={busy} onChange={(e) => setName(e.target.value)} style={{ minWidth: 220 }} />
          <button type="submit" className={s.btnPrimary} disabled={!name.trim() || busy}>Добавить</button>
        </form>
      </div>
      {hint && <p className={s.hint}>{hint}</p>}
      {items.length === 0 ? <p className={s.empty}>Пока пусто.</p> : (
        <ul className="ct-list">
          {items.map((item) => (
            <li key={item.id} className="ct-item" data-item-id={item.id}>
              <span className="ct-name">{item.name}</span>
              <span className={s.muted}>{item.managers ? `${item.managers} менедж.` : 'не назначен'}</span>
              <button type="button" className={s.btnSmDanger} onClick={() => remove(item)} aria-label={`Удалить ${item.name}`}>Удалить</button>
            </li>
          ))}
        </ul>
      )}
    </section>
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
    <div className="ct-page">
          <div className={s.head}><h2 className={s.title}>Справочники</h2></div>
          {error && <p className={s.error} role="alert">{error}</p>}
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
