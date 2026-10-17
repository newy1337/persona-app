import { useCallback, useEffect, useState } from 'react';
import { PanelUX } from '../../ui/PanelUX';
import {
  assignStaffPhotoSet,
  clearRegionStop,
  engageRegionStop,
  getRegionStop,
  getStaffAssignments,
} from '../../api/photoSets';
import s from '../../styles/AdminPage.module.scss';
import p from './PhotoSets.module.scss';

function RegionStopButton({ region }) {
  const [state, setState] = useState(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => getRegionStop().then(setState).catch(() => setState(null)), []);
  useEffect(() => { load(); }, [load, region]);
  if (!state?.region_code) return null;
  if (!state.can_manage)
    return state.engaged ? <span className={s.error} role="status">Образы выключены</span> : null;

  async function toggle() {
    const engaging = !state.engaged;
    if (!await PanelUX.confirm({
      title: engaging ? `Стоп региона ${state.region_code}?` : `Включить образы региона ${state.region_code}?`,
      message: '',
      confirmLabel: engaging ? 'Стоп' : 'Включить',
      danger: engaging,
    })) return;
    setBusy(true);
    try {
      if (engaging) await engageRegionStop();
      else await clearRegionStop();
      await load();
    } finally {
      setBusy(false);
    }
  }

  return (
    <button type="button" className={state.engaged ? s.btnPrimary : s.btnSmDanger} onClick={toggle} disabled={busy} aria-pressed={state.engaged}>
      {state.engaged ? 'Включить образы' : 'Стоп региона'}
    </button>
  );
}

/**
 * Какой образ получают новые собеседники каждого сотрудника — отдельно по
 * каждой личности его аккаунтов. Начатые диалоги остаются на прежнем образе.
 */
export default function StaffAssignments({ admin }) {
  const [region, setRegion] = useState('');
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');

  const load = useCallback(() => {
    if (admin && !region.trim()) { setData(null); return; }
    getStaffAssignments(admin ? region.trim() : undefined).then(setData).catch((e) => setError(e.detail || e.message));
  }, [admin, region]);
  useEffect(() => { load(); }, [load]);

  async function change(row, value) {
    const setId = value === '' ? null : Number(value);
    const target = data.sets.find((x) => x.id === setId);
    if (!await PanelUX.confirm({
      title: setId == null ? 'Снять образ?' : 'Назначить образ?',
      message: setId == null ? `${row.username} · ${row.persona_name}` : `${row.username} · ${row.persona_name} → «${target?.name}»`,
      confirmLabel: setId == null ? 'Снять' : 'Назначить',
    })) return;
    const key = `${row.user_id}:${row.persona_slug}`;
    setBusy(key);
    setError('');
    try {
      setData(await assignStaffPhotoSet(row.user_id, row.persona_slug, setId));
    } catch (e) {
      setError(e.detail || e.message);
    } finally {
      setBusy('');
    }
  }

  return (
    <section className={p.panel} aria-label="Образы сотрудников" style={{ marginTop: 24 }}>
      <div className={s.head} style={{ margin: 0 }}>
        <h3 className={s.modalTitle} style={{ margin: 0 }}>
          Образы{data?.region_code ? ` · регион ${data.region_code}` : ''}
        </h3>
        <div className={s.actions}>
          {admin && (
            <input className={s.field} placeholder="Код региона" value={region} maxLength={32}
              onChange={(e) => setRegion(e.target.value)} aria-label="Регион" style={{ maxWidth: 180 }} />
          )}
          {!admin && <RegionStopButton region={data?.region_code} />}
        </div>
      </div>
      {error && <p className={s.error} role="alert">{error}</p>}
      {data?.region_code && (data.rows.length ? (
        <table className="mr-dialog-table" aria-label="Назначение образов">
          <thead><tr><th scope="col">Сотрудник</th><th scope="col">Личность</th><th scope="col">Образ</th></tr></thead>
          <tbody>
            {data.rows.map((row) => {
              const key = `${row.user_id}:${row.persona_slug}`;
              return (
                <tr key={key}>
                  <td>{row.username}</td>
                  <td>{row.persona_name} <span className={s.muted}>· {row.accounts} акк.</span></td>
                  <td>
                    {data.can_assign ? (
                      <select className={s.select} value={row.set_id ?? ''} disabled={busy === key}
                        onChange={(e) => change(row, e.target.value)} aria-label={`Образ для ${row.username}, ${row.persona_name}`}>
                        <option value="">— без образа —</option>
                        {data.sets.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
                      </select>
                    ) : (row.set_name || <span className={s.muted}>не назначен</span>)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      ) : <p className={s.empty}>Нет сотрудников с аккаунтами</p>)}
    </section>
  );
}
