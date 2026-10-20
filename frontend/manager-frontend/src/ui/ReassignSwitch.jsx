import { useEffect, useState } from 'react';
import { PanelUX } from './PanelUX';
import { getRegionSettings, setAcceptReassigned } from '../api/buffer';
import s from '../styles/AdminPage.module.scss';

/** Переключатель «Получать перезабив» для одного региона. */
export function ReassignSwitch({ region, value, onChange, disabled = false }) {
  const [busy, setBusy] = useState(false);
  async function toggle() {
    const next = !value;
    if (!await PanelUX.confirm({
      title: next ? `Получать перезабив в регионе ${region}?` : `Не принимать перезабив в регионе ${region}?`,
      message: next
        ? 'Лиды с пометкой «перезабив» будут раздаваться менеджерам региона.'
        : 'Лиды с пометкой «перезабив» будут отбиваться ошибкой и не попадут в регион.',
      confirmLabel: next ? 'Получать' : 'Не принимать',
      danger: !next,
    })) return;
    setBusy(true);
    try { onChange(await setAcceptReassigned(region, next)); }
    catch (e) { PanelUX.error?.(e.detail || e.message); }
    finally { setBusy(false); }
  }
  return (
    <button type="button" className={value ? s.btnPrimary : s.btnSm} disabled={disabled || busy} onClick={toggle}
      aria-pressed={value} aria-label={`Получать перезабив: регион ${region}`} data-testid={`reassign-${region}`}>
      {value ? 'Перезабив: получаем' : 'Получать перезабив'}
    </button>
  );
}

/** Кнопка хеда на странице «Команда»: перезабив своего региона. */
export function OwnRegionReassign() {
  const [state, setState] = useState(null);
  useEffect(() => { getRegionSettings().then(setState).catch(() => setState(null)); }, []);
  const own = state?.items?.[0];
  if (!own || !state.can_manage) return null;
  return <ReassignSwitch region={own.region_code} value={own.accept_reassigned}
    onChange={(row) => setState((was) => ({ ...was, items: [row] }))} />;
}
