import { useCallback, useEffect, useState } from 'react';
import { PanelUX } from '../../ui/PanelUX';
import { clearRegionStop, engageRegionStop, getRegionStop } from '../../api/photoSets';
import styles from './Header.module.scss';

/**
 * Экстренная остановка автоматики региона. Хед включает и снимает её; менеджеры
 * региона видят, что бот, рассылка и войсер у них сейчас молчат.
 */
export default function RegionStop() {
  const [state, setState] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => getRegionStop().then(setState).catch(() => setState(null)), []);
  useEffect(() => {
    load();
    const t = setInterval(() => document.visibilityState === 'visible' && load(), 30000);
    return () => clearInterval(t);
  }, [load]);

  if (!state?.region_code || (!state.engaged && !state.can_manage)) return null;

  async function toggle() {
    if (busy) return;
    const engaging = !state.engaged;
    const ok = await PanelUX.confirm(engaging
      ? {
        title: `Остановить регион ${state.region_code}?`,
        message: 'Бот перестанет отвечать, рассылка лидам и войсер остановятся на всех аккаунтах региона. Ручные сообщения менеджеров продолжат уходить.',
        confirmLabel: 'Остановить',
        danger: true,
      }
      : {
        title: `Запустить регион ${state.region_code}?`,
        message: 'Бот, рассылка и войсер снова заработают на аккаунтах региона.',
        confirmLabel: 'Запустить',
      });
    if (!ok) return;
    setBusy(true);
    try {
      if (engaging) await engageRegionStop();
      else await clearRegionStop();
      await load();
    } finally {
      setBusy(false);
    }
  }

  if (!state.can_manage)
    return (
      <span className={styles.regionStopped} role="status" title={state.reason || undefined}>
        Регион {state.region_code} остановлен
      </span>
    );
  return (
    <button
      type="button"
      className={state.engaged ? styles.regionStopped : styles.regionStopBtn}
      onClick={toggle}
      disabled={busy}
      aria-pressed={state.engaged}
      title={state.engaged ? 'Нажмите, чтобы снова запустить автоматику региона' : 'Экстренно остановить автоматику региона'}
    >
      {state.engaged ? `Регион ${state.region_code} остановлен · запустить` : 'Стоп региона'}
    </button>
  );
}
