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

/** Стоп региона: хед выключает и включает образы своего региона. */
export function RegionStopButton() {
  const [state, setState] = useState(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => getRegionStop().then(setState).catch(() => setState(null)), []);
  useEffect(() => { load(); }, [load]);
  if (!state?.region_code || !state.can_manage) return null;

  async function toggle() {
    const engaging = !state.engaged;
    if (!await PanelUX.confirm({
      title: engaging ? `Стоп региона ${state.region_code}?` : `Включить образы региона ${state.region_code}?`,
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
 * Назначения образов сотрудникам регионов из списка: по строке на сотрудника
 * и личность его аккаунтов. Новый образ получают только новые собеседники.
 */
export function usePhotoAssignments(regions) {
  const key = [...new Set(regions.filter(Boolean))].sort().join(',');
  const [byRegion, setByRegion] = useState({});
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (!key) return;
    Promise.all(key.split(',').map((region) => getStaffAssignments(region).then((r) => [region, r])))
      .then((pairs) => setByRegion(Object.fromEntries(pairs)))
      .catch((e) => setError(e.detail || e.message));
  }, [key]);

  async function change(row, region, value) {
    const data = byRegion[region];
    const setId = value === '' ? null : Number(value);
    const target = data?.sets?.find((x) => x.id === setId);
    if (!await PanelUX.confirm({
      title: setId == null ? 'Снять образ?' : 'Назначить образ?',
      message: setId == null ? `${row.username} · ${row.persona_name}` : `${row.username} · ${row.persona_name} → «${target?.name}»`,
      confirmLabel: setId == null ? 'Снять' : 'Назначить',
    })) return;
    const id = `${row.user_id}:${row.persona_slug}`;
    setBusy(id);
    setError('');
    try {
      const fresh = await assignStaffPhotoSet(row.user_id, row.persona_slug, setId);
      setByRegion((prev) => ({ ...prev, [region]: fresh }));
    } catch (e) {
      setError(e.detail || e.message);
    } finally {
      setBusy('');
    }
  }

  return { byRegion, busy, error, change };
}

/** Ячейка «Образ» в строке сотрудника. */
export function PhotoCell({ user, photo }) {
  const data = photo.byRegion[user.region_code];
  const rows = data?.rows?.filter((r) => r.user_id === user.user_id) ?? [];
  if (!rows.length) return null;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {rows.map((row) => {
        const id = `${row.user_id}:${row.persona_slug}`;
        return (
          <label key={id} className="mr-caption" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ minWidth: 56 }}>{row.persona_name}</span>
            {data.can_assign ? (
              <select className={s.select} value={row.set_id ?? ''} disabled={photo.busy === id}
                onChange={(e) => photo.change(row, user.region_code, e.target.value)}
                aria-label={`Образ для ${row.username}, ${row.persona_name}`}>
                <option value="">— без образа —</option>
                {(data.sets ?? []).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
              </select>
            ) : <span>{row.set_name || 'не назначен'}</span>}
          </label>
        );
      })}
    </div>
  );
}
