import { useCallback, useEffect, useRef, useState } from 'react';
import { Search } from 'lucide-react';
import { api } from '../../api/client';
import Nav from '../../components/Header/Header';
import { getAccounts as loadAccounts } from '../../api/accounts';
import { PanelUX as ux } from '../../ui/PanelUX';
import { VoiceBotLink } from '../VoiceWork/VoiceBotLink';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardAction, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { NativeCheckbox } from '@/components/ui/native-checkbox';
import { NativeSelect } from '@/components/ui/native-select';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { cn } from '@/lib/utils';

const roles = { admin: 'админ', manager: 'менеджер', voice: 'войсер' };
const roleBadge = { admin: 'default', manager: 'secondary', voice: 'outline' };
const validRegion = value => /^\d{3,4}$/.test(value);
const errorText = e => {
  const message = e.detail || e.message || 'Не удалось выполнить действие';
  return Array.isArray(message) ? message.join('; ') : String(message);
};
const caption = 'text-xs text-muted-foreground';

/* Режим карточек на узких экранах: таблица рассыпается на блоки по строке.
   Рамка карточки с «!»: иначе её снимает сброс tr:last-child у TableBody. */
const cardRow = 'max-[1100px]:mb-3 max-[1100px]:grid max-[1100px]:grid-cols-[minmax(0,1fr)_minmax(130px,.65fr)] max-[1100px]:gap-3 max-[1100px]:rounded-lg max-[1100px]:border! max-[1100px]:bg-card max-[1100px]:p-4 max-[1100px]:last:mb-0';
const cardCell = 'max-[1100px]:block max-[1100px]:p-0';

function VoicerSelect({ voicerList, value, onChange, disabled }) {
  return (
    <Field label="Войсер" hint="Назначение применяется к новым заданиям.">
      <NativeSelect value={value} disabled={disabled} onChange={e => onChange(e.target.value)}>
        <option value="">Не назначен</option>
        {voicerList.map(v => <option key={v.user_id} value={v.user_id}>{`${v.username}${v.telegram_linked ? '' : ' · Telegram не подключён'}`}</option>)}
      </NativeSelect>
    </Field>
  );
}

function RoleSelect({ roleList, value, onChange, disabled }) {
  return (
    <Field label="Роль">
      <NativeSelect value={value} disabled={disabled} onChange={e => onChange(e.target.value)}>
        {roleList.map(r => <option key={r} value={r}>{roles[r] || r}</option>)}
      </NativeSelect>
    </Field>
  );
}

function CreateForm({ roleList, voicerList, onCreate, onCancel }) {
  const [username, setUsername] = useState('');
  const [role, setRole] = useState('manager');
  const [region, setRegion] = useState('');
  const [voicer, setVoicer] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const valid = Boolean(username.trim()) && (role !== 'manager' || validRegion(region));
  async function submit(e) {
    e.preventDefault();
    if (!valid || busy) return;
    setBusy(true); setError('');
    try { await onCreate({ username: username.trim(), role, ...(region ? { region_code: region } : {}), ...(role === 'manager' ? { voicer_id: voicer ? Number(voicer) : null } : {}) }); }
    catch (e) { setError(errorText(e)); }
    finally { setBusy(false); }
  }
  return (
    <Card className="mb-6 gap-4 py-4">
      <CardContent className="px-4">
        <form onSubmit={submit} aria-label="Создание учётки" className="grid grid-cols-1 items-end gap-x-4 gap-y-2 md:grid-cols-3">
          <Field label="Логин">
            <Input value={username} autoFocus required maxLength={64} autoComplete="off" onChange={e => setUsername(e.target.value)} />
          </Field>
          <RoleSelect roleList={roleList} value={role} onChange={setRole} />
          <Field label="Регион (3–4 цифры)">
            <Input type="text" inputMode="numeric" pattern="[0-9]{3,4}" maxLength={4} required={role === 'manager'} placeholder="Например, 077" value={region} onChange={e => setRegion(e.target.value.replace(/\D/g, '').slice(0, 4))} />
          </Field>
          {role === 'manager' && <VoicerSelect voicerList={voicerList} value={voicer} onChange={setVoicer} />}
          <p className={cn(caption, 'md:col-span-3')}>Пароль создастся автоматически. После создания можно скопировать логин и пароль.</p>
          <div className="min-h-5 text-sm text-destructive md:col-span-3">{error && <p role="alert">{error}</p>}</div>
          <div className="flex flex-wrap gap-2 md:col-span-3">
            <Button type="submit" disabled={!valid || busy}>{busy ? 'Создаём…' : 'Создать'}</Button>
            <Button type="button" variant="outline" disabled={busy} onClick={onCancel}>Отмена</Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

function Credentials({ value, onClose, onRegenerate }) {
  const [visible, setVisible] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { setVisible(false); setCopied(false); setError(''); }, [value.user_id, value.password]);
  async function copy() {
    try {
      await navigator.clipboard.writeText(`Логин: ${value.username}\nПароль: ${value.password}${value.region_code ? `\nРегион: ${value.region_code}` : ''}`);
      setCopied(true); setError('');
    } catch { setError('Не удалось скопировать. Нажмите «Показать» и скопируйте данные из полей.'); }
  }
  async function regenerate() {
    if (!await ux.confirm({ title: 'Создать новый пароль?', message: `Учётка ${value.username}. Прежний пароль перестанет действовать.`, confirmLabel: 'Создать пароль' })) return;
    setBusy(true); setError('');
    try { await onRegenerate(value.user_id); }
    catch (e) { setError(errorText(e)); }
    finally { setBusy(false); }
  }
  return (
    <Card className="mb-6 gap-4 py-4" role="region" aria-label="Данные для входа">
      <CardHeader className="px-4">
        <CardTitle className="text-sm font-medium [overflow-wrap:anywhere]">{`Данные для входа: ${value.username}`}</CardTitle>
        <CardAction>
          <Button type="button" variant="outline" size="sm" onClick={onClose}>Закрыть</Button>
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 px-4">
        <div className="grid grid-cols-1 gap-x-4 gap-y-2 md:grid-cols-3">
          <Field label="Логин для входа">
            <Input className="font-mono" readOnly value={value.username} />
          </Field>
          <Field label="Регион">
            <Input className="font-mono" readOnly value={value.region_code || 'Не задан'} />
          </Field>
          {value.password ? (
            <Field label="Пароль для входа">
              <Input className="font-mono" readOnly autoComplete="off" type={visible ? 'text' : 'password'} value={value.password} />
            </Field>
          ) : (
            <p className={cn(caption, 'md:col-span-3')}>Пароль этой старой учётки не сохранён для просмотра. Можно создать новый и выдать его менеджеру.</p>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          {value.password && <Button type="button" variant="outline" onClick={() => setVisible(!visible)}>{visible ? 'Скрыть пароль' : 'Показать пароль'}</Button>}
          {value.password && <Button type="button" variant="outline" onClick={copy}>{copied ? 'Скопировано' : 'Копировать логин + пароль'}</Button>}
          <Button type="button" variant="outline" disabled={busy} onClick={regenerate}>{busy ? 'Создаём…' : 'Создать новый пароль'}</Button>
        </div>
        <div className="min-h-5 text-sm text-destructive">{error && <p role="alert">{error}</p>}</div>
      </CardContent>
    </Card>
  );
}

function ManagerEditor({ user, me, roleList, voicerList, onSave, onClose }) {
  const [role, setRole] = useState(user.role), [region, setRegion] = useState(user.region_code || '');
  const [voicer, setVoicer] = useState(String(user.voicer_id || ''));
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const lock = useRef(false);
  const assigned = user.account_ids;
  const changed = role !== user.role || region !== (user.region_code || '') || voicer !== String(user.voicer_id || '');
  const valid = region === '' ? role !== 'manager' || user.role === 'manager' && !user.region_code : validRegion(region);
  async function save(event) {
    event.preventDefault();
    if (lock.current || !changed || !valid) return;
    lock.current = true;
    if (user.role === 'manager' && role !== 'manager' && assigned.length && !await ux.confirm({ title: 'Изменить роль?', message: `У ${user.username} будут освобождены аккаунты: ${assigned.length}.`, confirmLabel: 'Изменить роль' })) { lock.current = false; return; }
    setBusy(true); setError('');
    try {
      await onSave(user.user_id, { role, region_code: region || null, voicer_id: role === 'manager' && voicer ? Number(voicer) : null, ...(user.role === 'manager' && role !== 'manager' ? { account_ids: [] } : {}) });
      onClose();
    } catch (e) { setError(ux.readableError(e)); }
    finally { lock.current = false; setBusy(false); }
  }
  return (
    <ux.Modal title={`Учётка: ${user.username}`} onClose={onClose} busy={busy} footer={<>
      <Button type="button" variant="outline" disabled={busy} onClick={onClose}>Отмена</Button>
      <Button type="submit" form="manager-editor" disabled={!changed || !valid || busy}>{busy ? 'Сохраняем…' : 'Сохранить'}</Button>
    </>}>
      <form id="manager-editor" className="grid gap-2" onSubmit={save}>
        <RoleSelect roleList={roleList} value={role} disabled={busy || user.user_id === me?.user_id} onChange={setRole} />
        <Field label="Регион (3–4 цифры)" error={valid ? '' : 'Укажите код региона: 3 или 4 цифры.'}>
          <Input data-autofocus value={region} disabled={busy} inputMode="numeric" maxLength={4} placeholder="Например, 0077" onChange={e => setRegion(e.target.value.replace(/\D/g, '').slice(0, 4))} />
        </Field>
        {role === 'manager' && <VoicerSelect voicerList={voicerList} value={voicer} onChange={setVoicer} disabled={busy} />}
        <div className="min-h-5 text-sm text-destructive">{error && <p role="alert">{error}</p>}</div>
      </form>
    </ux.Modal>
  );
}

function AccountAssignment({ user, userList, accountList, onSave, onClose }) {
  const [selected, setSelected] = useState(() => new Set(user.account_ids));
  const [query, setQuery] = useState(''), [filter, setFilter] = useState('all');
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const lock = useRef(false);
  const assigned = user.account_ids;
  const ownerById = new Map();
  for (const manager of userList) if (manager.role === 'manager') for (const id of manager.account_ids) ownerById.set(id, manager);
  const changed = selected.size !== assigned.length || assigned.some(id => !selected.has(id));
  const q = query.toLowerCase().trim(), phoneQuery = query.replace(/[^0-9]/g, '');
  const matched = accountList.filter(account => {
    if (filter === 'selected' && !selected.has(account.id)) return false;
    if (filter === 'free' && ownerById.has(account.id)) return false;
    return !q || [account.username, account.display_name, account.phone_e164, ownerById.get(account.id)?.username, String(account.id)].some(value => String(value || '').toLowerCase().includes(q)) || phoneQuery.length >= 3 && /^[+()\s\d-]+$/.test(query) && (account.phone_e164 || '').includes(phoneQuery);
  });
  const moving = accountList.filter(account => selected.has(account.id) && ownerById.has(account.id) && ownerById.get(account.id).user_id !== user.user_id);
  async function save() {
    if (lock.current || !changed) return;
    lock.current = true;
    if (moving.length && !await ux.confirm({ title: 'Переназначить аккаунты?', message: `Эти аккаунты перейдут к ${user.username}:\n` + moving.map(account => `${account.username ? '@' + account.username : account.phone_e164} — от ${ownerById.get(account.id).username}`).join('\n'), confirmLabel: 'Переназначить' })) { lock.current = false; return; }
    setBusy(true); setError('');
    try { await onSave(user.user_id, { account_ids: [...selected] }); onClose(); }
    catch (e) { setError(ux.readableError(e)); }
    finally { lock.current = false; setBusy(false); }
  }
  const toggle = (id, checked) => setSelected(current => { const next = new Set(current); if (checked) next.add(id); else next.delete(id); return next; });
  return (
    <ux.Modal title={`Аккаунты: ${user.username}`} wide busy={busy} onClose={onClose} footer={<>
      <span className={cn(caption, 'me-auto min-w-[12ch] tabular-nums')} role="status">{`Выбрано: ${selected.size}`}</span>
      <Button type="button" variant="outline" disabled={busy} onClick={onClose}>Отмена</Button>
      <Button type="button" disabled={!changed || busy} onClick={save}>{busy ? 'Сохраняем…' : 'Сохранить'}</Button>
    </>}>
      <Input type="search" aria-label="Поиск аккаунтов" placeholder="Номер, ник, имя или менеджер" data-autofocus value={query} onChange={e => setQuery(e.target.value)} />
      <div className="my-3 flex flex-wrap gap-1.5">
        {[['all', 'Все'], ['selected', 'Выбранные'], ['free', 'Свободные']].map(([key, label]) => (
          <Button key={key} type="button" size="sm" variant={filter === key ? 'secondary' : 'ghost'} aria-pressed={filter === key} onClick={() => setFilter(key)}>{label}</Button>
        ))}
      </div>
      <div className={cn('mr-assignment-list', 'max-h-[340px] min-h-[200px] overflow-y-auto overscroll-contain rounded-md border bg-background p-1 [scrollbar-gutter:stable]')}>
        {matched.length ? matched.map(account => {
          const owner = ownerById.get(account.id);
          const picked = selected.has(account.id);
          return (
            <label key={account.id} className={cn('grid cursor-pointer grid-cols-[1rem_minmax(0,1fr)_minmax(90px,30%)] items-start gap-3 rounded-md border p-3 hover:bg-muted/50', picked ? 'border-primary/30 bg-accent' : 'border-transparent')}>
              <NativeCheckbox className="mt-0.5" disabled={busy} checked={picked} aria-label={`Аккаунт ${account.phone_e164 || account.username || account.id}`} onChange={e => toggle(account.id, e.target.checked)} />
              <span className="flex min-w-0 flex-col gap-0.5 [overflow-wrap:anywhere]">
                <strong className="text-sm font-medium">{account.display_name || account.username || account.phone_e164 || `#${account.id}`}</strong>
                <span className={cn(caption, 'font-mono')}>{[account.phone_e164, account.username ? '@' + account.username : null].filter(Boolean).join(' · ')}</span>
              </span>
              <span className={cn(caption, 'text-right [overflow-wrap:anywhere]')}>{owner ? owner.user_id === user.user_id ? 'У этого менеджера' : owner.username : 'Свободен'}</span>
            </label>
          );
        }) : <p className={cn(caption, 'p-3')}>Аккаунты не найдены. Измените поиск или фильтр.</p>}
      </div>
      <div className="mt-3 min-h-5 text-xs text-warning-foreground">{moving.length > 0 && <p>{`Будут переназначены от других менеджеров: ${moving.length}`}</p>}</div>
      <div className="min-h-5 text-sm text-destructive">{error && <p role="alert">{error}</p>}</div>
    </ux.Modal>
  );
}

function SkeletonRow() {
  return (
    <TableRow className={cardRow}>
      <TableCell className={cn('p-3 align-top', cardCell)}><Skeleton className="h-5 w-32" /><Skeleton className="mt-2 h-4 w-20" /></TableCell>
      <TableCell className={cn('p-3 align-top', cardCell)}><Skeleton className="h-5 w-20" /><Skeleton className="mt-2 h-4 w-24" /></TableCell>
      <TableCell className={cn('p-3 align-top', cardCell)}><Skeleton className="h-8 w-40" /></TableCell>
      <TableCell className={cn('p-3 align-top', cardCell)}><Skeleton className="h-8 w-56" /></TableCell>
    </TableRow>
  );
}

export function ManagersPage() {
  const [data, setData] = useState({ roles: [], items: null }), [accountList, setAccountList] = useState([]), [me, setMe] = useState(null);
  const [error, setError] = useState(''), [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false), [credentials, setCredentials] = useState(null), [editing, setEditing] = useState(null), [assigning, setAssigning] = useState(null);
  const [query, setQuery] = useState('');
  const [opening, setOpening] = useState(null);
  const reload = useCallback(async () => {
    const [fresh, accountRows, currentUser] = await Promise.all([api.get('/api/managers'), loadAccounts(), api.get('/auth/me')]);
    setData(fresh); setAccountList(accountRows); setMe(currentUser); return fresh;
  }, []);
  useEffect(() => { reload().catch(e => setError(ux.readableError(e))).finally(() => setLoading(false)); }, [reload]);
  async function showCredentials(user) {
    setError(''); setOpening(user.user_id);
    try { setCredentials(await api.get(`/api/managers/${user.user_id}/credentials`)); }
    catch (e) { setError(ux.readableError(e)); }
    finally { setOpening(null); }
  }
  async function create(body) {
    const result = await api.post('/api/managers', body);
    setData(result); setCreating(false); setError('');
    await showCredentials({ user_id: result.created_user_id });
  }
  async function save(id, body) {
    const result = await api.put(`/api/managers/${id}`, body);
    setData(result); setError('');
    if (credentials?.user_id === id) setCredentials(null);
  }
  async function openAccounts(user) {
    setOpening(user.user_id); setError('');
    try {
      const fresh = await reload();
      const list = fresh.items || [];
      const current = list.find(item => item.user_id === user.user_id);
      if (current?.role === 'manager') setAssigning(current);
    }
    catch (e) { setError(ux.readableError(e)); }
    finally { setOpening(null); }
  }
  async function remove(user) {
    if (!await ux.confirm({ title: `Удалить ${user.username}?`, message: 'Учётка будет удалена. Закреплённые аккаунты освободятся.', confirmLabel: 'Удалить', danger: true })) return;
    try { setData(await api.delete(`/api/managers/${user.user_id}`)); if (credentials?.user_id === user.user_id) setCredentials(null); }
    catch (e) { setError(ux.readableError(e)); }
  }
  async function regenerate(id) { setCredentials(await api.post(`/api/managers/${id}/password`, {})); }
  const state = ux.useActions(), pending = state.pending.some(key => key.includes('/api/managers'));
  const managerList = data.items || [];
  const voicerList = managerList.filter(u => u.role === 'voice');
  const needle = query.trim().toLowerCase();
  const visible = managerList.filter(user => [user.username, user.region_code, roles[user.role]].some(value => String(value || '').toLowerCase().includes(needle)));
  const cell = cn('p-3 align-top whitespace-normal [overflow-wrap:anywhere]', cardCell);
  return (
    <div className="app">
      <Nav />
      <main className="main">
        <div className="container">
          <div className="my-6 flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-xl font-semibold">Менеджеры</h2>
            <Button type="button" disabled={creating} onClick={() => { setCreating(true); setCredentials(null); }}>+ Создать учётку</Button>
          </div>
          {creating && <CreateForm roleList={data.roles} voicerList={voicerList} onCreate={create} onCancel={() => setCreating(false)} />}
          <div className="min-h-5 text-sm text-destructive">{error && <p role="alert">{error}</p>}</div>
          {credentials && <Credentials value={credentials} onClose={() => setCredentials(null)} onRegenerate={regenerate} />}
          <div className="mt-2 mb-3 flex flex-wrap items-center gap-3">
            <div className="relative w-full max-w-[360px]">
              <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
              <Input className="h-8 pl-8" type="search" aria-label="Поиск менеджеров" placeholder="Логин, регион или роль" value={query} onChange={e => setQuery(e.target.value)} />
            </div>
            <span className={cn(caption, 'min-w-[14ch] tabular-nums')}>{loading ? 'Загружаем…' : `Показано: ${visible.length}`}</span>
          </div>
          <div className="rounded-lg border bg-card max-[1100px]:border-0 max-[1100px]:bg-transparent">
            <Table aria-label="Менеджеры" className="table-fixed max-[1100px]:block [&_tbody]:max-[1100px]:block">
              <TableHeader className="max-[1100px]:hidden">
                <TableRow className="hover:bg-transparent">
                  {[['Учётка', 'w-[22%]'], ['Роль / регион', 'w-[18%]'], ['Аккаунты', 'w-[28%]'], ['Действия', 'w-[32%]']].map(([title, width]) => (
                    <TableHead key={title} scope="col" className={cn('h-10 px-3 text-xs font-medium text-muted-foreground', width)}>{title}</TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading && data.items === null ? <><SkeletonRow /><SkeletonRow /><SkeletonRow /></> : visible.map(user => {
                  const assigned = user.account_ids;
                  const linked = accountList.filter(account => assigned.includes(account.id));
                  return (
                    <TableRow key={user.user_id} data-manager-id={user.user_id} className={cardRow}>
                      <TableCell className={cn(cell, 'max-[1100px]:col-start-1 max-[1100px]:row-start-1')}>
                        <strong className="block text-sm font-semibold">{user.username}</strong>
                        {user.user_id === me?.user_id && <span className={cn(caption, 'block')}>Это вы</span>}
                        {user.role === 'manager' && <span className={cn(caption, 'block')}>{`Войсер: ${user.voicer_username || 'не назначен'}`}</span>}
                        {user.role === 'voice' && <span className={cn(caption, 'block')}>{user.telegram_linked ? 'Telegram подключён' : 'Telegram не подключён'}</span>}
                      </TableCell>
                      <TableCell className={cn(cell, 'max-[1100px]:col-start-2 max-[1100px]:row-start-1')}>
                        <Badge variant={roleBadge[user.role] || 'outline'}>{roles[user.role] || user.role}</Badge>
                        <span className={cn(caption, 'mt-1.5 block font-mono')}>{user.region_code ? `Регион ${user.region_code}` : 'Регион не задан'}</span>
                      </TableCell>
                      <TableCell className={cn(cell, 'max-[1100px]:col-span-2 max-[1100px]:row-start-2')}>
                        {user.role === 'manager' ? <>
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="min-w-[13ch] text-sm tabular-nums">{`Назначено: ${assigned.length}`}</span>
                            <Button type="button" variant="outline" size="sm" disabled={pending || opening !== null} aria-label={`Назначить аккаунты: ${user.username}`} onClick={() => openAccounts(user)}>{opening === user.user_id ? 'Загружаем…' : 'Назначить'}</Button>
                          </div>
                          <div className={cn(caption, 'mt-1.5 min-h-4 font-mono leading-relaxed')}>{linked.length > 0 && <>{linked.slice(0, 2).map(account => account.username ? '@' + account.username : account.phone_e164 || `#${account.id}`).join(' · ')}{linked.length > 2 ? ` · ещё ${linked.length - 2}` : ''}</>}</div>
                        </> : <span className={caption}>{user.role === 'admin' ? 'Доступ ко всем' : '—'}</span>}
                      </TableCell>
                      <TableCell className={cn(cell, 'max-[1100px]:col-span-2 max-[1100px]:row-start-3')}>
                        <div className="flex flex-wrap items-center gap-2">
                          <Button type="button" variant="outline" size="sm" disabled={pending} onClick={() => setEditing(user)}>Изменить</Button>
                          {user.role === 'voice' && <VoiceBotLink userId={user.user_id} linked={user.telegram_linked} />}
                          <Button type="button" variant="outline" size="sm" disabled={pending || opening !== null} onClick={() => showCredentials(user)}>Логин и пароль</Button>
                          {user.user_id !== me?.user_id && <Button type="button" variant="ghost" size="sm" className="text-destructive hover:text-destructive" disabled={pending} onClick={() => remove(user)}>Удалить</Button>}
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
          <div className="min-h-5 pt-3">{!loading && !visible.length && <p className={caption}>Ничего не найдено. Измените поиск.</p>}</div>
          {editing && <ManagerEditor key={editing.user_id} user={editing} me={me} roleList={data.roles} voicerList={voicerList} onSave={save} onClose={() => setEditing(null)} />}
          {assigning && <AccountAssignment key={assigning.user_id} user={assigning} userList={managerList} accountList={accountList} onSave={save} onClose={() => setAssigning(null)} />}
        </div>
      </main>
    </div>
  );
}

export default ManagersPage;
