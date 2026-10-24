import { useEffect, useState } from 'react';
import { PanelUX } from './PanelUX';
import { getRegionSettings, setAcceptCold, setAcceptReassigned } from '../api/buffer';
import { Button } from '@/components/ui/button';

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
    <Button type="button" size="sm" variant={value ? 'secondary' : 'outline'} disabled={disabled || busy} onClick={toggle}
      aria-pressed={value} aria-label={`Получать перезабив: регион ${region}`} data-testid={`reassign-${region}`}>
      {value ? 'Перезабив: получаем' : 'Получать перезабив'}
    </Button>
  );
}

/** Переключатель «Получать холодку» для одного региона. */
export function ColdSwitch({ region, value, onChange, disabled = false }) {
  const [busy, setBusy] = useState(false);
  async function toggle() {
    const next = !value;
    if (!await PanelUX.confirm({
      title: next ? `Получать холодку в регионе ${region}?` : `Не получать холодку в регионе ${region}?`,
      message: next
        ? 'Холодка будет раздаваться поровну менеджерам региона, у которых она включена в строке менеджера.'
        : 'Менеджеры региона перестанут получать холодку, даже если она включена у них лично.',
      confirmLabel: next ? 'Получать' : 'Не получать',
      danger: !next,
    })) return;
    setBusy(true);
    try { onChange(await setAcceptCold(region, next)); }
    catch (e) { PanelUX.error?.(e.detail || e.message); }
    finally { setBusy(false); }
  }
  return (
    <Button type="button" size="sm" variant={value ? 'secondary' : 'outline'} disabled={disabled || busy} onClick={toggle}
      aria-pressed={value} aria-label={`Получать холодку: регион ${region}`} data-testid={`cold-${region}`}>
      {value ? 'Холодка: получаем' : 'Получать холодку'}
    </Button>
  );
}

/** Кнопки хеда на странице «Команда»: перезабив и холодка своего региона. */
export function OwnRegionReassign() {
  const [state, setState] = useState(null);
  useEffect(() => { getRegionSettings().then(setState).catch(() => setState(null)); }, []);
  const own = state?.items?.[0];
  if (!own || !state.can_manage) return null;
  const onChange = (row) => setState((was) => ({ ...was, items: [row] }));
  return (
    <>
      <ReassignSwitch region={own.region_code} value={own.accept_reassigned} onChange={onChange} />
      <ColdSwitch region={own.region_code} value={Boolean(own.accept_cold)} onChange={onChange} />
    </>
  );
}
