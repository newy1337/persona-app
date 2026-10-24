import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, ArrowUpDown, Minus, Plus } from 'lucide-react';
import DateRangePicker, { mskToday, human } from '../../components/DateRangePicker/DateRangePicker';
import { PanelUX as ux } from '../../ui/PanelUX';
import PickerModal from '../../ui/PickerModal';
import { getManagers, updateManager } from '../../api/managers';
import { getDonors } from '../../api/donors';
import { getSources } from '../../api/sources';
import { getPersonas } from '../../api/personas';
import { getRegionSettings } from '../../api/buffer';
import { ColdSwitch, ReassignSwitch } from '../../ui/ReassignSwitch';
import { ROLE_LABELS, isManagerRole } from '../../utils/roles';
import { cn } from '@/lib/utils';
import { useRouteBusy } from '@/components/AppLayout/routeBusy';
import { PageHeader } from '@/components/PageHeader/PageHeader';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { NativeSelect } from '@/components/ui/native-select';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

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

function LabeledSwitch({ checked, label, text, disabled, onToggle }) {
  return (
    <label className={cn('inline-flex cursor-pointer items-center gap-2 text-xs', checked ? 'text-foreground' : 'text-muted-foreground', disabled && 'cursor-default opacity-60')}>
      <Switch checked={checked} disabled={disabled} aria-label={label} onCheckedChange={onToggle} />
      <span>{text}</span>
    </label>
  );
}

function UserRow({ user, personaNames, coldRegion, onSave, onError, onPick }) {
  const manager = isManagerRole(user.role);
  const [online, setOnline] = useState(Boolean(user.online));
  const [cold, setCold] = useState(Boolean(user.cold_leads));
  const [quota, setQuota] = useState(user.lead_quota ?? '');
  const [busy, setBusy] = useState(false);
  // Следим за значениями, а не за объектом: после любого сохранения список приходит заново,
  // и сброс по объекту стирал бы лимит, который админ ещё печатает в другой строке.
  useEffect(() => { setOnline(Boolean(user.online)); setQuota(user.lead_quota ?? ''); }, [user.online, user.lead_quota]);
  useEffect(() => { setCold(Boolean(user.cold_leads)); }, [user.cold_leads]);
  const quotaValue = quota === '' ? null : Number(quota);

  async function toggleOnline() {
    const next = !online;
    setOnline(next); setBusy(true);
    try { await onSave(user.user_id, { online: next }); }
    catch (err) { setOnline(!next); onError(ux.readableError(err)); }
    finally { setBusy(false); }
  }
  async function toggleCold() {
    const next = !cold;
    setCold(next); setBusy(true);
    try { await onSave(user.user_id, { cold_leads: next }); }
    catch (err) { setCold(!next); onError(ux.readableError(err)); }
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
  const dash = <span className="text-muted-foreground">—</span>;
  const pickClass = 'h-auto min-h-8 w-full justify-start py-1 text-left whitespace-normal [overflow-wrap:anywhere]';
  return (
    <TableRow className="us-row" data-user-id={user.user_id} data-online={online ? '1' : '0'}>
      <TableCell className="pl-4 whitespace-normal">
        <strong className="text-sm font-medium">{user.username}</strong>
        <div className="text-xs text-muted-foreground">{ROLE_LABELS[user.role] || user.role}{user.lead_username ? ` · руководитель ${user.lead_username}` : ''}</div>
      </TableCell>
      <TableCell>
        {manager ? <LabeledSwitch checked={online} label={`Онлайн: ${user.username}`} text={online ? 'Онлайн' : 'Оффлайн'} disabled={busy} onToggle={toggleOnline} /> : dash}
      </TableCell>
      <TableCell className="whitespace-normal">
        {manager && coldRegion ? (
          <LabeledSwitch checked={cold} label={`Холодка: ${user.username}`} text={cold ? 'Да' : 'Нет'} disabled={busy} onToggle={toggleCold} />
        ) : manager ? <span className="text-xs text-muted-foreground" title="Включите «Получать холодку» у региона">выкл. в регионе</span> : dash}
      </TableCell>
      <TableCell>
        {manager ? (
          <div className="inline-flex h-8 items-center overflow-hidden rounded-md border border-input" role="group" aria-label={`Лимит клиентов в сутки: ${user.username}`}>
            <Button type="button" variant="ghost" size="icon-sm" className="rounded-none" disabled={busy || quota === ''} aria-label={`Меньше: ${user.username}`} onMouseDown={(e) => e.preventDefault()} onClick={() => step(-1)}><Minus aria-hidden="true" /></Button>
            <input className="h-full w-12 border-x border-input bg-transparent text-center text-sm tabular-nums outline-none placeholder:text-muted-foreground" inputMode="numeric" value={quota} placeholder="∞" aria-label={`Лимит клиентов в сутки: ${user.username}`} disabled={busy}
              onChange={(e) => setQuota(e.target.value.replace(/\D/g, '').slice(0, 5))} onBlur={() => saveQuota()} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); saveQuota(); } }} />
            <Button type="button" variant="ghost" size="icon-sm" className="rounded-none" disabled={busy} aria-label={`Больше: ${user.username}`} onMouseDown={(e) => e.preventDefault()} onClick={() => step(1)}><Plus aria-hidden="true" /></Button>
          </div>
        ) : dash}
      </TableCell>
      <TableCell>{manager ? <strong className="text-sm font-medium tabular-nums" data-testid={`leads-count-${user.user_id}`}>{user.leads_count ?? 0}</strong> : dash}</TableCell>
      <TableCell className="whitespace-normal">
        {manager ? (
          <Button type="button" variant="outline" size="sm" className={pickClass} disabled={busy} onClick={() => onPick('sources', user)} aria-label={`Источники: ${user.username}`} title="Выбрать источники">
            {summary(user.lead_sources)}
          </Button>
        ) : dash}
      </TableCell>
      <TableCell className="whitespace-normal">
        {manager ? (
          <Button type="button" variant="outline" size="sm" className={pickClass} disabled={busy} onClick={() => onPick('donors', user)} aria-label={`Доноры: ${user.username}`} title="Выбрать доноров">
            {summary(user.donors)}
          </Button>
        ) : dash}
      </TableCell>
      <TableCell className="whitespace-normal">
        {manager ? (
          <Button type="button" variant="outline" size="sm" className={pickClass} disabled={busy} onClick={() => onPick('personas', user)} aria-label={`Личности: ${user.username}`} title="Выбрать личности">
            {summary((user.lead_personas ?? []).map((slug) => personaNames.get(slug) ?? slug))}
          </Button>
        ) : dash}
      </TableCell>
    </TableRow>
  );
}

function SortTh({ col, sort, onSort, children, className }) {
  const active = sort.col === col;
  const Icon = !active ? ArrowUpDown : sort.dir === 'asc' ? ArrowUp : ArrowDown;
  return (
    <TableHead className={cn('whitespace-normal', className)} aria-sort={active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
      <button type="button" className={cn('inline-flex items-center gap-1 text-left hover:text-foreground', active && 'text-foreground')} onClick={() => onSort(col)}>
        {children} <Icon className="size-3.5 shrink-0" aria-hidden="true" />
      </button>
    </TableHead>
  );
}

export default function Users() {
  const [users, setUsers] = useState([]);
  const [donors, setDonors] = useState([]);
  const [sources, setSources] = useState([]);
  const [personas, setPersonas] = useState([]);
  const [regionSettings, setRegionSettings] = useState({});
  const [query, setQuery] = useState('');
  const [region, setRegion] = useState('');
  const [range, setRange] = useState(() => ({ from: mskToday(), to: mskToday() }));
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [picker, setPicker] = useState(null);
  const [sort, setSort] = useState({ col: null, dir: 'desc' });
  const toggleSort = (col) => setSort((was) => (was.col === col ? (was.dir === 'desc' ? { col, dir: 'asc' } : { col: null, dir: 'desc' }) : { col, dir: 'desc' }));

  useRouteBusy(loading);

  const load = useCallback(async () => {
    const [m, d, src, ps, rs] = await Promise.all([getManagers(range), getDonors(), getSources(), getPersonas().catch(() => ({ items: [] })), getRegionSettings().catch(() => ({ items: [] }))]);
    setRegionSettings(Object.fromEntries((rs.items ?? []).map((x) => [x.region_code, x])));
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

  const onRegionChange = (row) => setRegionSettings((was) => ({ ...was, [row.region_code]: row }));
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
    <div className="container">
      <PageHeader title="LeadGet" description={`Онлайн: ${onlineCount} · ${loading ? 'загружаем…' : `показано: ${visible.length}`}`}>
        <Input className="w-56" type="search" aria-label="Поиск пользователей" placeholder="Поиск по логину" value={query} onChange={(e) => setQuery(e.target.value)} />
        <NativeSelect className="w-44" aria-label="Регион" value={region} onChange={(e) => setRegion(e.target.value)}>
          <option value="">Все регионы</option>
          {regions.map((r) => <option key={r} value={r}>Регион {r}</option>)}
          <option value="none">Без региона</option>
        </NativeSelect>
        <DateRangePicker from={range.from} to={range.to} onChange={setRange} />
      </PageHeader>
      {error && <p className="mb-3 text-sm text-destructive" role="alert">{error}</p>}
      {groups.length > 0 && (
        <div className="rounded-lg border bg-card">
          <Table className="min-w-[1040px] table-fixed">
            <colgroup>
              <col style={{ width: '17%' }} /><col style={{ width: '10%' }} /><col style={{ width: '10%' }} /><col style={{ width: '12%' }} /><col style={{ width: '9%' }} /><col style={{ width: '14%' }} /><col style={{ width: '14%' }} /><col style={{ width: '14%' }} />
            </colgroup>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-4">Пользователь</TableHead>
                <SortTh col="online" sort={sort} onSort={toggleSort}>Онлайн</SortTh>
                <TableHead>Холодка</TableHead>
                <TableHead className="whitespace-normal">Клиентов в сутки</TableHead>
                <SortTh col="leads_count" sort={sort} onSort={toggleSort}>{countTitle}</SortTh>
                <TableHead>Источники</TableHead>
                <TableHead>Доноры</TableHead>
                <TableHead>Личности</TableHead>
              </TableRow>
            </TableHeader>
            {groups.map(({ region, items }) => (
              <TableBody key={region || 'none'} aria-label={region ? `Регион ${region}` : 'Без региона'}>
                <TableRow className="bg-muted/40 hover:bg-muted/40">
                  <TableCell colSpan={8} className="py-1.5 pl-4">
                    <div className="us-region-title flex flex-wrap items-center gap-2 text-xs font-semibold tracking-wide uppercase">
                      {region ? `Регион ${region}` : 'Без региона'} <span className="font-normal tracking-normal text-muted-foreground normal-case">· {items.length}</span>
                      {region && (
                        <span className="ml-auto flex flex-wrap justify-end gap-2 tracking-normal normal-case">
                          <ColdSwitch region={region} value={Boolean(regionSettings[region]?.accept_cold)} onChange={onRegionChange} />
                          <ReassignSwitch region={region} value={Boolean(regionSettings[region]?.accept_reassigned)} onChange={onRegionChange} />
                        </span>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
                {items.map((u) => <UserRow key={u.user_id} user={u} personaNames={personaNames} coldRegion={Boolean(region && regionSettings[region]?.accept_cold)} onSave={save} onError={setError} onPick={(kind, user) => setPicker({ kind, user })} />)}
              </TableBody>
            ))}
          </Table>
        </div>
      )}
      {loading && !groups.length && (
        <div className="grid gap-2" role="status" aria-busy="true">
          <span className="sr-only">Загружаем сотрудников…</span>
          {[0, 1, 2, 3, 4, 5].map((i) => <Skeleton key={i} className="h-12 w-full rounded-lg" />)}
        </div>
      )}
      {!loading && !groups.length && <p className="rounded-lg border bg-card p-6 text-center text-sm text-muted-foreground">Ничего не найдено.</p>}
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
