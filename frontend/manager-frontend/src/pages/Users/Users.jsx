import { useCallback, useEffect, useMemo, useState } from 'react';
import Header from '../../components/Header/Header';
import DateRangePicker, { mskToday, human } from '../../components/DateRangePicker/DateRangePicker';
import { PanelUX as ux } from '../../ui/PanelUX';
import PickerModal from '../../ui/PickerModal';
import { getManagers, updateManager } from '../../api/managers';
import { getDonors } from '../../api/donors';
import { getSources } from '../../api/sources';
import { getPersonas } from '../../api/personas';
import { getRegionSettings } from '../../api/buffer';
import { ReassignSwitch } from '../../ui/ReassignSwitch';
import { ROLE_LABELS, isManagerRole } from '../../utils/roles';
import s from '../../styles/AdminPage.module.scss';
import './users.css';

/** Группировка по региону: регионы по возрастанию, «без региона» в конце. */
export function groupByRegion(users) {
  const groups = new Map();
  for (const u of users) {
    const key = u.region_code || '';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(u);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => (a === '' ? 1 : b === '' ? -1 : a.localeCompare(b)))
    .map(([region, items]) => ({ region, items }));
}

/** Сортировка внутри региона: онлайн / получено сегодня; без выбора — как пришло. */
export function sortUsers(items, sort) {
  if (!sort?.col) return items;
  const key = (u) => (!isManagerRole(u.role) ? -1 : sort.col === 'online' ? (u.online ? 1 : 0) : (u.leads_count ?? 0));
  const dir = sort.dir === 'asc' ? 1 : -1;
  return [...items].sort((a, b) => (key(a) - key(b)) * dir || a.username.localeCompare(b.username));
}

/** Короткая сводка выбранного: «любые», «beboo, vk» или «beboo, vk · ещё 3». */
export function summary(names, max = 2) {
  if (!names?.length) return 'любые';
  return names.length > max ? `${names.slice(0, max).join(', ')} · ещё ${names.length - max}` : names.join(', ');
}

function UserRow({ user, personaNames, onSave, onError, onPick }) {
  const manager = isManagerRole(user.role);
  const [online, setOnline] = useState(Boolean(user.online));
  const [quota, setQuota] = useState(user.lead_quota ?? '');
  const [busy, setBusy] = useState(false);
  // Следим за значениями, а не за объектом: после любого сохранения список приходит заново,
  // и сброс по объекту стирал бы лимит, который админ ещё печатает в другой строке.
  useEffect(() => { setOnline(Boolean(user.online)); setQuota(user.lead_quota ?? ''); }, [user.online, user.lead_quota]);
  const quotaValue = quota === '' ? null : Number(quota);

  async function toggleOnline() {
    const next = !online;
    setOnline(next); setBusy(true);
    try { await onSave(user.user_id, { online: next }); }
    catch (err) { setOnline(!next); onError(ux.readableError(err)); }
    finally { setBusy(false); }
  }
  async function saveQuota(next = quotaValue) {
    if (next === (user.lead_quota ?? null) || busy) return;
    setBusy(true);
    try { await onSave(user.user_id, { lead_quota: next }); }
    catch (err) { setQuota(user.lead_quota ?? ''); onError(ux.readableError(err)); }
    finally { setBusy(false); }
  }
  /** Минус на нуле снимает лимит (∞), плюс на ∞ ставит 1. */
  function step(delta) {
    const current = quota === '' ? null : Number(quota);
    const next = current === null ? (delta > 0 ? 1 : null) : Math.max(0, current + delta);
    const nextValue = current === 0 && delta < 0 ? null : next;
    setQuota(nextValue === null ? '' : String(nextValue));
    saveQuota(nextValue);
  }
  const dash = <span className={s.muted}>—</span>;
  return (
    <tr className="us-row" data-user-id={user.user_id} data-online={online ? '1' : '0'}>
      <td className="us-name">
        <strong>{user.username}</strong>
        <div className={s.muted}>{ROLE_LABELS[user.role] || user.role}{user.lead_username ? ` · руководитель ${user.lead_username}` : ''}</div>
      </td>
      <td className="us-online">
        {manager ? (
          <button type="button" className={`us-switch ${online ? 'us-switch-on' : ''}`} role="switch" aria-checked={online} aria-label={`Онлайн: ${user.username}`} disabled={busy} onClick={toggleOnline}>
            <span className="us-switch-knob" />
            <span className="us-switch-text">{online ? 'Онлайн' : 'Оффлайн'}</span>
          </button>
        ) : dash}
      </td>
      <td className="us-quota">
        {manager ? (
          <div className="us-stepper" role="group" aria-label={`Лимит клиентов в сутки: ${user.username}`}>
            <button type="button" className="us-step" disabled={busy || quota === ''} aria-label={`Меньше: ${user.username}`} onMouseDown={(e) => e.preventDefault()} onClick={() => step(-1)}>−</button>
            <input className="us-step-input" inputMode="numeric" value={quota} placeholder="∞" aria-label={`Лимит клиентов в сутки: ${user.username}`} disabled={busy}
              onChange={(e) => setQuota(e.target.value.replace(/\D/g, '').slice(0, 5))} onBlur={() => saveQuota()} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); saveQuota(); } }} />
            <button type="button" className="us-step" disabled={busy} aria-label={`Больше: ${user.username}`} onMouseDown={(e) => e.preventDefault()} onClick={() => step(1)}>+</button>
          </div>
        ) : dash}
      </td>
      <td className="us-today">{manager ? <strong data-testid={`leads-count-${user.user_id}`}>{user.leads_count ?? 0}</strong> : dash}</td>
      <td className="us-pick">
        {manager ? (
          <button type="button" className={`${s.btnSm} us-pick-btn`} disabled={busy} onClick={() => onPick('sources', user)} aria-label={`Источники: ${user.username}`} title="Выбрать источники">
            {summary(user.lead_sources)}
          </button>
        ) : dash}
      </td>
      <td className="us-pick">
        {manager ? (
          <button type="button" className={`${s.btnSm} us-pick-btn`} disabled={busy} onClick={() => onPick('donors', user)} aria-label={`Доноры: ${user.username}`} title="Выбрать доноров">
            {summary(user.donors)}
          </button>
        ) : dash}
      </td>
      <td className="us-pick">
        {manager ? (
          <button type="button" className={`${s.btnSm} us-pick-btn`} disabled={busy} onClick={() => onPick('personas', user)} aria-label={`Личности: ${user.username}`} title="Выбрать личности">
            {summary((user.lead_personas ?? []).map((slug) => personaNames.get(slug) ?? slug))}
          </button>
        ) : dash}
      </td>
    </tr>
  );
}

function SortTh({ col, sort, onSort, children }) {
  const active = sort.col === col;
  return (
    <th className={`us-sortable ${active ? 'us-sorted' : ''}`} aria-sort={active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
      <button type="button" className="us-sort-btn" onClick={() => onSort(col)}>{children} <span aria-hidden="true">{active ? (sort.dir === 'asc' ? '▴' : '▾') : '↕'}</span></button>
    </th>
  );
}

export default function Users() {
  const [users, setUsers] = useState([]);
  const [donors, setDonors] = useState([]);
  const [sources, setSources] = useState([]);
  const [personas, setPersonas] = useState([]);
  const [reassign, setReassign] = useState({});
  const [query, setQuery] = useState('');
  const [region, setRegion] = useState('');
  const [range, setRange] = useState(() => ({ from: mskToday(), to: mskToday() }));
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [picker, setPicker] = useState(null);
  const [sort, setSort] = useState({ col: null, dir: 'desc' });
  const toggleSort = (col) => setSort((was) => (was.col === col ? (was.dir === 'desc' ? { col, dir: 'asc' } : { col: null, dir: 'desc' }) : { col, dir: 'desc' }));

  const load = useCallback(async () => {
    const [m, d, src, ps, rs] = await Promise.all([getManagers(range), getDonors(), getSources(), getPersonas().catch(() => ({ items: [] })), getRegionSettings().catch(() => ({ items: [] }))]);
    setReassign(Object.fromEntries((rs.items ?? []).map((x) => [x.region_code, x.accept_reassigned])));
    setUsers(m.items ?? []);
    setDonors(d.items ?? []);
    setSources(src.items ?? []);
    setPersonas((ps.items ?? []).map((x) => ({ id: x.slug, name: x.name || x.slug })));
  }, [range]);
  useEffect(() => { load().catch((e) => setError(ux.readableError(e))).finally(() => setLoading(false)); }, [load]);

  async function save(userId, patch) {
    await updateManager(userId, patch);
    // Ответ правки считает «получено» за сегодня; перечитываем с выбранным периодом.
    setUsers((await getManagers(range)).items ?? []);
    setError('');
  }

  const regions = useMemo(() => [...new Set(users.map((u) => u.region_code).filter(Boolean))].sort(), [users]);
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    let staff = users.filter((u) => u.role !== 'voice');
    if (region) staff = staff.filter((u) => (region === 'none' ? !u.region_code : u.region_code === region));
    return q ? staff.filter((u) => [u.username, ROLE_LABELS[u.role]].some((v) => String(v || '').toLowerCase().includes(q))) : staff;
  }, [users, query, region]);
  const isToday = range.from === mskToday() && range.to === mskToday();
  const countTitle = isToday ? 'Получено сегодня' : range.from === range.to ? `Получено ${human(range.from)}` : `Получено ${human(range.from)}–${human(range.to)}`;
  const groups = useMemo(() => groupByRegion(visible).map((g) => ({ ...g, items: sortUsers(g.items, sort) })), [visible, sort]);
  const onlineCount = users.filter((u) => isManagerRole(u.role) && u.online).length;
  const pickUser = picker && users.find((u) => u.user_id === picker.user.user_id);
  const personaNames = useMemo(() => new Map(personas.map((x) => [x.id, x.name])), [personas]);
  // Источники менеджера, которых нет в справочнике (заведены через API или удалены), остаются
  // в списке с пометкой: иначе сохранение выбора молча стёрло бы их.
  const sourceItems = useMemo(() => {
    const known = new Set(sources.map((x) => x.name.toLowerCase()));
    const orphans = (pickUser?.lead_sources ?? []).filter((n) => !known.has(n.toLowerCase()));
    return [...sources, ...orphans.map((n) => ({ id: `orphan:${n}`, name: n, note: 'нет в справочнике' }))];
  }, [sources, pickUser]);

  return (
    <div className="app us-page">
      <Header />
      <main className="main">
        <div className="container">
          <div className={`${s.head} us-head`}>
            <div>
              <h2 className={s.title}>LeadGet</h2>
              <span className={s.muted}>Онлайн: {onlineCount} · {loading ? 'загружаем…' : `показано: ${visible.length}`}</span>
            </div>
            <div className="us-toolbar">
              <input className={s.field} type="search" aria-label="Поиск пользователей" placeholder="Поиск по логину" value={query} onChange={(e) => setQuery(e.target.value)} />
              <select className={s.select} aria-label="Регион" value={region} onChange={(e) => setRegion(e.target.value)}>
                <option value="">Все регионы</option>
                {regions.map((r) => <option key={r} value={r}>Регион {r}</option>)}
                <option value="none">Без региона</option>
              </select>
              <DateRangePicker from={range.from} to={range.to} onChange={setRange} />
            </div>
          </div>
          {error && <p className={s.error} role="alert">{error}</p>}
          {groups.length > 0 && (
            <div className={s.tableWrap}>
              <table className={`${s.table} us-table`}>
                <colgroup>
                  <col style={{ width: '20%' }} /><col style={{ width: '11%' }} /><col style={{ width: '12%' }} /><col style={{ width: '10%' }} /><col style={{ width: '15%' }} /><col style={{ width: '16%' }} /><col style={{ width: '16%' }} />
                </colgroup>
                <thead>
                  <tr>
                    <th>Пользователь</th>
                    <SortTh col="online" sort={sort} onSort={toggleSort}>Онлайн</SortTh>
                    <th>Клиентов в сутки</th>
                    <SortTh col="leads_count" sort={sort} onSort={toggleSort}>{countTitle}</SortTh>
                    <th>Источники</th>
                    <th>Доноры</th>
                    <th>Личности</th>
                  </tr>
                </thead>
                {groups.map(({ region, items }) => (
                  <tbody key={region || 'none'} className="us-region" aria-label={region ? `Регион ${region}` : 'Без региона'}>
                    <tr className="us-region-row"><td colSpan={7}><span className="us-region-title">{region ? `Регион ${region}` : 'Без региона'} <span className={s.muted}>· {items.length}</span>
                      {region && <span style={{ marginLeft: 'auto', textTransform: 'none', letterSpacing: 0 }}><ReassignSwitch region={region} value={Boolean(reassign[region])} onChange={(row) => setReassign((was) => ({ ...was, [row.region_code]: row.accept_reassigned }))} /></span>}
                    </span></td></tr>
                    {items.map((u) => <UserRow key={u.user_id} user={u} personaNames={personaNames} onSave={save} onError={setError} onPick={(kind, user) => setPicker({ kind, user })} />)}
                  </tbody>
                ))}
              </table>
            </div>
          )}
          {!loading && !groups.length && <p className={s.empty}>Ничего не найдено.</p>}
        </div>
      </main>
      {pickUser && picker.kind === 'donors' && (
        <PickerModal
          title={`Доноры: ${pickUser.username}`}
          items={donors}
          value={new Set(pickUser.donor_ids ?? [])}
          onSave={(ids) => save(pickUser.user_id, { donor_ids: ids })}
          onClose={() => setPicker(null)}
          emptyHint="Доноров нет. Добавьте их в справочниках."
          anyHint="Ничего не выбрано — принимает лидов любых доноров."
        />
      )}
      {pickUser && picker.kind === 'personas' && (
        <PickerModal
          title={`Личности: ${pickUser.username}`}
          items={personas}
          value={new Set(pickUser.lead_personas ?? [])}
          onSave={(ids) => save(pickUser.user_id, { lead_personas: ids })}
          onClose={() => setPicker(null)}
          emptyHint="Личностей нет."
          anyHint="Ничего не выбрано — принимает лидов любой личности."
        />
      )}
      {pickUser && picker.kind === 'sources' && (
        <PickerModal
          title={`Источники: ${pickUser.username}`}
          items={sourceItems}
          value={new Set(sourceItems.filter((x) => (pickUser.lead_sources ?? []).some((n) => n.toLowerCase() === x.name.toLowerCase())).map((x) => x.id))}
          onSave={(ids) => save(pickUser.user_id, { lead_sources: sourceItems.filter((x) => ids.includes(x.id)).map((x) => x.name) })}
          onClose={() => setPicker(null)}
          emptyHint="Источников нет. Добавьте их в справочниках."
          anyHint="Ничего не выбрано — принимает лидов из любых источников."
        />
      )}
    </div>
  );
}
