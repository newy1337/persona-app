import { useMemo, useState } from 'react';
import { PanelUX as ux } from './PanelUX';
import s from '../styles/AdminPage.module.scss';

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
      <button type="button" className={s.btn} disabled={busy} onClick={onClose}>Отмена</button>
      <button type="button" className={s.btnPrimary} disabled={!changed || busy} onClick={save}>{busy ? 'Сохраняем…' : 'Сохранить'}</button>
    </>}>
      <div className="mr-assignment-filters">
        <input className={s.field} type="search" aria-label="Поиск" placeholder="Поиск" value={query} autoFocus onChange={(e) => setQuery(e.target.value)} style={{ flex: 1 }} />
        <span className={s.muted} style={{ alignSelf: 'center' }}>Выбрано: {picked.size}</span>
        {picked.size > 0 && <button type="button" className={s.btnSmGhost} onClick={() => setPicked(new Set())}>Снять всё</button>}
      </div>
      <div className="mr-assignment-list" role="group" aria-label={title}>
        {items.length === 0 ? <p className={s.muted}>{emptyHint}</p> : visible.length === 0 ? <p className={s.muted}>Ничего не найдено.</p> : visible.map((i) => (
          <label key={i.id} className="mr-assignment-item">
            <input type="checkbox" checked={picked.has(i.id)} disabled={busy} onChange={() => toggle(i.id)} />
            <span>{i.name}</span>
            <span className={s.muted}>{i.managers != null ? `${i.managers} менедж.` : ''}</span>
          </label>
        ))}
      </div>
      <p className={s.hint} style={{ margin: '10px 0 0' }}>{anyHint}</p>
      {error && <p className={s.error} role="alert">{error}</p>}
    </ux.Modal>
  );
}
