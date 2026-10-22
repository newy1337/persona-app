import { useCallback, useEffect, useState } from 'react';
import { PanelUX } from '../../ui/PanelUX';
import PickerModal from '../../ui/PickerModal';
import {
  assignStaffPhotoSets,
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
 * Назначения образов сотрудникам регионов из списка: по строке на сотрудника.
 * Хед задаёт набор образов учётки, к личностям их привязывает сам сотрудник
 * на странице «Образы». Новый образ получают только новые собеседники.
 */
export function usePhotoAssignments(regions) {
  const key = [...new Set(regions.filter(Boolean))].sort().join(',');
  const [byRegion, setByRegion] = useState({});
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState('');
  const [picking, setPicking] = useState(null);

  useEffect(() => {
    if (!key) return;
    Promise.all(key.split(',').map((region) => getStaffAssignments(region).then((r) => [region, r])))
      .then((pairs) => setByRegion(Object.fromEntries(pairs)))
      .catch((e) => setError(e.detail || e.message));
  }, [key]);

  async function save(row, region, setIds) {
    setBusy(row.user_id);
    setError('');
    try {
      const fresh = await assignStaffPhotoSets(row.user_id, setIds);
      setByRegion((prev) => ({ ...prev, [region]: fresh }));
    } finally {
      setBusy(null);
    }
  }

  return { byRegion, busy, error, picking, setPicking, save };
}

/** Подпись образа: к какой личности его привязал сотрудник. */
export function personaNote(set) {
  return set.persona_name ? `${set.set_name} → ${set.persona_name}` : `${set.set_name} → в запасе`;
}

/** Ячейка «Образ» в строке сотрудника: образы учётки и выбор их в попапе. */
export function PhotoCell({ user, photo }) {
  const data = photo.byRegion[user.region_code];
  const row = data?.rows?.find((r) => r.user_id === user.user_id);
  if (!row) return null;
  const picking = photo.picking === row.user_id;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }} data-testid={`photo-cell-${user.user_id}`}>
      {row.sets.length === 0 && <span className="mr-caption">без образа</span>}
      {row.sets.map((x) => (
        <span key={x.set_id} className="mr-caption" style={{ color: x.persona_name ? undefined : '#f5b14a' }}>{personaNote(x)}</span>
      ))}
      {data.can_assign && (
        <button type="button" className={s.btnSm} disabled={photo.busy === row.user_id} onClick={() => photo.setPicking(row.user_id)} aria-label={`Образы для ${row.username}`}>
          {row.sets.length ? `Образы: ${row.sets.length}` : 'Назначить образы'}
        </button>
      )}
      {picking && (
        <PickerModal
          title={`Образы: ${row.username}`}
          items={(data.sets ?? []).map((x) => ({ id: x.id, name: x.name }))}
          value={new Set(row.sets.map((x) => x.set_id))}
          onSave={(ids) => photo.save(row, user.region_code, ids)}
          onClose={() => photo.setPicking(null)}
          emptyHint="В регионе нет образов. Создайте их на странице «Образы»."
          anyHint="К личностям образы привязывает сам сотрудник на странице «Образы». Снятый образ больше не получает новых собеседников, начатые диалоги остаются на нём."
        />
      )}
    </div>
  );
}
