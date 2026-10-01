import { PanelUX } from '../../ui/PanelUX';
import { useEffect, useState } from 'react';
import { getPrices, putPrices, resetPrices } from '../../api/usage';
import s from '../../styles/AdminPage.module.scss';
import p from './Stats.module.scss';

const FIELDS = [
  ['input', 'вход'],
  ['output', 'выход'],
  ['cache_write', 'запись кеша'],
  ['cache_read', 'чтение кеша'],
];

export default function PricesEditor({ onChanged, onError }) {
  const [table, setTable] = useState(null);
  const [draft, setDraft] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = () =>
    getPrices()
      .then((t) => {
        setTable(t);
        setDraft(JSON.parse(JSON.stringify(t.models)));
      })
      .catch((e) => onError(e.detail || e.message));

  useEffect(() => {
    load();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  if (!table || !draft) return <p className={s.empty}>Загружаю цены…</p>;

  const dirty = JSON.stringify(draft) !== JSON.stringify(table.models);
  const set = (model, field, value) =>
    setDraft((v) => ({ ...v, [model]: { ...v[model], [field]: value } }));

  async function save() {
    setBusy(true);
    try {
      const t = await putPrices({ models: draft, families: table.families, note: table.note });
      setTable(t);
      setDraft(JSON.parse(JSON.stringify(t.models)));
      onChanged();
    } catch (e) {
      onError(e.detail || e.message);
    } finally {
      setBusy(false);
    }
  }

  async function reset() {
    if (!await PanelUX.confirm('Вернуть цены по умолчанию?')) return;
    setBusy(true);
    try {
      const t = await resetPrices();
      setTable(t);
      setDraft(JSON.parse(JSON.stringify(t.models)));
      onChanged();
    } catch (e) {
      onError(e.detail || e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={p.prices}>
      <p className={s.hint}>
        USD за 1 млн токенов. {table.is_default ? 'Сейчас работают умолчания — сверьте с актуальным прайс-листом.' : 'Своя таблица.'}
        {table.note && <> {table.note}</>}
      </p>
      <div className={s.tableWrap}>
        <table className={s.table}>
          <thead>
            <tr>
              <th>Модель</th>
              {FIELDS.map(([, label]) => <th key={label}>{label}</th>)}
            </tr>
          </thead>
          <tbody>
            {Object.entries(draft).map(([model, price]) => (
              <tr key={model}>
                <td className={s.mono}>{model}</td>
                {FIELDS.map(([field]) => (
                  <td key={field}>
                    <input
                      className={`${s.field} ${p.priceInput}`}
                      inputMode="decimal"
                      value={price[field]}
                      onChange={(e) => set(model, field, e.target.value)}
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className={s.actions} style={{ justifyContent: 'flex-end' }}>
        <button className={s.btn} disabled={busy || table.is_default} onClick={reset}>Вернуть умолчания</button>
        <button className={s.btnPrimary} disabled={busy || !dirty} onClick={save}>
          {busy ? 'Сохранение…' : 'Сохранить цены'}
        </button>
      </div>
    </div>
  );
}
