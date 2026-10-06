import { useCallback, useEffect, useRef, useState } from 'react';
import { Eye, EyeOff, KeyRound, MoreHorizontal, Pencil, Trash2, Users } from 'lucide-react';
import { api } from '../../api/client';
import { getAccounts as loadAccounts } from '../../api/accounts';
import { PanelUX as ux } from '../../ui/PanelUX';
import { VoiceBotLink } from '../VoiceWork/VoiceBotLink';
import { useRouteBusy } from '@/components/AppLayout/routeBusy';
import { IconAction } from '@/components/IconAction/IconAction';
import { PageHeader } from '@/components/PageHeader/PageHeader';
import { SearchInput } from '@/components/SearchInput/SearchInput';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { NativeCheckbox } from '@/components/ui/native-checkbox';
import { NativeSelect } from '@/components/ui/native-select';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { cn } from '@/lib/utils';

const roles = { admin: 'админ', manager: 'менеджер', voice: 'войсер' };
const validRegion = value => /^\d{3,4}$/.test(value);
const errorText = e => {
  const message = e.detail || e.message || 'Не удалось выполнить действие';
  return Array.isArray(message) ? message.join('; ') : String(message);
};
const caption = 'text-xs text-muted-foreground';
// Строка ошибки в окнах занята всегда: форма не меняет высоту.
const errorSlot = 'min-h-4 text-xs text-destructive';

/* Колонки списка. Строка — две строки текста (20 + 16) и отступы по 8px: 52px. */
const COLUMNS = [['Учётка', ''], ['Роль', 'w-32'], ['Регион', 'w-24'], ['Аккаунты', 'w-[34%]']];
const headCell = 'h-9 px-3 text-xs font-medium text-muted-foreground';
const cell = 'px-3 py-2';
const line = 'truncate text-sm leading-5';
const subline = cn(caption, 'truncate leading-4');

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
    <ux.Modal title="Новая учётка" onClose={onCancel} busy={busy} footer={<>
      <Button type="button" variant="outline" disabled={busy} onClick={onCancel}>Отмена</Button>
      <Button type="submit" form="manager-create" disabled={!valid || busy}>{busy ? 'Создаём…' : 'Создать'}</Button>
    </>}>
      <form id="manager-create" onSubmit={submit} aria-label="Создание учётки" className="grid gap-x-4 gap-y-2 sm:grid-cols-2">
        <Field label="Логин" className="sm:col-span-2">
          <Input value={username} data-autofocus required maxLength={64} autoComplete="off" disabled={busy} onChange={e => setUsername(e.target.value)} />
        </Field>
        <RoleSelect roleList={roleList} value={role} disabled={busy} onChange={setRole} />
        <Field label="Регион (3–4 цифры)">
          <Input type="text" inputMode="numeric" pattern="[0-9]{3,4}" maxLength={4} required={role === 'manager'} placeholder="Например, 077" disabled={busy} value={region} onChange={e => setRegion(e.target.value.replace(/\D/g, '').slice(0, 4))} />
        </Field>
        {role === 'manager' && <div className="sm:col-span-2"><VoicerSelect voicerList={voicerList} value={voicer} disabled={busy} onChange={setVoicer} /></div>}
        <p className={cn(caption, 'sm:col-span-2')}>Пароль создастся автоматически. После создания можно скопировать логин и пароль.</p>
        <div className={cn(errorSlot, 'sm:col-span-2')}>{error && <p role="alert">{error}</p>}</div>
      </form>
    </ux.Modal>
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
    } catch { setError('Не удалось скопировать. Нажмите «Показать пароль» и скопируйте данные из полей.'); }
  }
  async function regenerate() {
    if (!await ux.confirm({ title: 'Создать новый пароль?', message: `Учётка ${value.username}. Прежний пароль перестанет действовать.`, confirmLabel: 'Создать пароль' })) return;
    setBusy(true); setError('');
    try { await onRegenerate(value.user_id); }
    catch (e) { setError(errorText(e)); }
    finally { setBusy(false); }
  }
  // Главная кнопка окна одна: скопировать данные, а если пароль не сохранён — создать новый.
  return (
    <ux.Modal title={`Данные для входа: ${value.username}`} onClose={onClose} busy={busy} footer={<>
      {value.password && <Button type="button" variant="ghost" className="me-auto" disabled={busy} onClick={regenerate}>{busy ? 'Создаём…' : 'Создать новый пароль'}</Button>}
      <Button type="button" variant="outline" disabled={busy} onClick={onClose}>Закрыть</Button>
      {value.password
        ? <Button type="button" className="min-w-[14.5rem]" data-autofocus onClick={copy}>{copied ? 'Скопировано' : 'Копировать логин + пароль'}</Button>
        : <Button type="button" disabled={busy} onClick={regenerate}>{busy ? 'Создаём…' : 'Создать новый пароль'}</Button>}
    </>}>
      <div className="grid gap-x-4 gap-y-2 sm:grid-cols-2">
        <Field label="Логин для входа">
          <Input className="font-mono" readOnly value={value.username} />
        </Field>
        <Field label="Регион">
          <Input className="font-mono" readOnly value={value.region_code || 'Не задан'} />
        </Field>
        {value.password ? (
          <Field label="Пароль для входа" className="sm:col-span-2">
            <span className="flex items-center gap-1.5">
              <Input className="font-mono" readOnly autoComplete="off" type={visible ? 'text' : 'password'} value={value.password} />
              <IconAction icon={visible ? EyeOff : Eye} label={visible ? 'Скрыть пароль' : 'Показать пароль'} size="icon" variant="outline" onClick={() => setVisible(!visible)} />
            </span>
          </Field>
        ) : (
          <p className={cn(caption, 'sm:col-span-2')}>Пароль этой старой учётки не сохранён для просмотра. Можно создать новый и выдать его менеджеру.</p>
        )}
        <div className={cn(errorSlot, 'sm:col-span-2')}>{error && <p role="alert">{error}</p>}</div>
      </div>
    </ux.Modal>
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
      <form id="manager-editor" className="grid gap-x-4 gap-y-2 sm:grid-cols-2" onSubmit={save}>
        <RoleSelect roleList={roleList} value={role} disabled={busy || user.user_id === me?.user_id} onChange={setRole} />
        <Field label="Регион (3–4 цифры)" error={valid ? '' : 'Укажите код региона: 3 или 4 цифры.'}>
          <Input data-autofocus value={region} disabled={busy} inputMode="numeric" maxLength={4} placeholder="Например, 0077" onChange={e => setRegion(e.target.value.replace(/\D/g, '').slice(0, 4))} />
        </Field>
        {role === 'manager' && <div className="sm:col-span-2"><VoicerSelect voicerList={voicerList} value={voicer} onChange={setVoicer} disabled={busy} /></div>}
        <div className={cn(errorSlot, 'sm:col-span-2')}>{error && <p role="alert">{error}</p>}</div>
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
      <div className="flex min-h-8 flex-wrap items-center gap-2">
        <SearchInput className="flex-[1_1_220px]" aria-label="Поиск аккаунтов" placeholder="Номер, ник, имя или менеджер" data-autofocus value={query} onChange={setQuery} />
        <div className="flex items-center gap-0.5" role="group" aria-label="Какие аккаунты показать">
          {[['all', 'Все'], ['selected', 'Выбранные'], ['free', 'Свободные']].map(([key, label]) => (
            <Button key={key} type="button" size="sm" variant={filter === key ? 'secondary' : 'ghost'} className={cn('shadow-none', filter !== key && 'text-muted-foreground')} aria-pressed={filter === key} onClick={() => setFilter(key)}>{label}</Button>
          ))}
        </div>
      </div>
      <div className={cn('mr-assignment-list', 'mt-3 max-h-[340px] min-h-[200px] divide-y overflow-y-auto overscroll-contain rounded-md border [scrollbar-gutter:stable]')}>
        {matched.length ? matched.map(account => {
          const owner = ownerById.get(account.id);
          return (
            <label key={account.id} className="grid cursor-pointer grid-cols-[1rem_minmax(0,1fr)_minmax(90px,30%)] items-center gap-3 px-3 py-2 hover:bg-muted/50">
              <NativeCheckbox disabled={busy} checked={selected.has(account.id)} aria-label={`Аккаунт ${account.phone_e164 || account.username || account.id}`} onChange={e => toggle(account.id, e.target.checked)} />
              <span className="flex min-w-0 flex-col">
                <span className={line}>{account.display_name || account.username || account.phone_e164 || `#${account.id}`}</span>
                <span className={cn(subline, 'font-mono')}>{[account.phone_e164, account.username ? '@' + account.username : null].filter(Boolean).join(' · ')}</span>
              </span>
              <span className={cn(caption, 'truncate text-right')}>{owner ? owner.user_id === user.user_id ? 'У этого менеджера' : owner.username : 'Свободен'}</span>
            </label>
          );
        }) : <p className={cn(caption, 'p-3')}>Аккаунты не найдены. Измените поиск или фильтр.</p>}
      </div>
      <div className={cn(caption, 'mt-2 flex min-h-4 items-center gap-1.5')}>{moving.length > 0 && <>
        <span className="size-1.5 shrink-0 rounded-full bg-warning-foreground" aria-hidden="true" />
        <p>{`Будут переназначены от других менеджеров: ${moving.length}`}</p>
      </>}</div>
      <div className={cn(errorSlot, 'mt-1')}>{error && <p role="alert">{error}</p>}</div>
    </ux.Modal>
  );
}

/* Скелет собран из тех же ячеек и строк текста, что и настоящая строка: высота совпадает сама. */
function SkeletonRow() {
  return (
    <TableRow className="hover:bg-transparent">
      <TableCell className={cell}><div className="flex h-5 items-center"><Skeleton className="h-3.5 w-32" /></div><div className="flex h-4 items-center"><Skeleton className="h-3 w-24" /></div></TableCell>
      <TableCell className={cell}><Skeleton className="h-5 w-20" /></TableCell>
      <TableCell className={cell}><Skeleton className="h-3.5 w-10" /></TableCell>
      <TableCell className={cell}><div className="flex h-5 items-center"><Skeleton className="h-3.5 w-24" /></div><div className="flex h-4 items-center"><Skeleton className="h-3 w-40" /></div></TableCell>
      <TableCell className={cell}><div className="flex h-8 items-center justify-end"><Skeleton className="h-5 w-24" /></div></TableCell>
    </TableRow>
  );
}

export function ManagersPage() {
  const [data, setData] = useState({ roles: [], items: null }), [accountList, setAccountList] = useState([]), [me, setMe] = useState(null);
  const [error, setError] = useState(''), [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false), [credentials, setCredentials] = useState(null), [editing, setEditing] = useState(null), [assigning, setAssigning] = useState(null);
  const [query, setQuery] = useState('');
  const [opening, setOpening] = useState(null);
  useRouteBusy(loading);
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
  const firstLoad = loading && data.items === null;
  return (
    <>
      <div className="container">
        <PageHeader title="Менеджеры">
          <Button type="button" size="sm" onClick={() => { setCreating(true); setCredentials(null); }}>+ Создать учётку</Button>
        </PageHeader>
        <div className="mb-3 flex min-h-8 flex-wrap items-center gap-x-4 gap-y-2">
          <SearchInput className="w-full max-w-xs" aria-label="Поиск менеджеров" placeholder="Логин, регион или роль" value={query} onChange={setQuery} />
          {/* Одно место и для счётчика, и для ошибки страницы: список под ним не сдвигается. */}
          {error
            ? <p className="min-w-0 flex-1 text-xs text-destructive" role="alert">{error}</p>
            : <span className={cn(caption, 'min-w-[14ch] tabular-nums')}>{loading ? 'Загружаем…' : `Показано: ${visible.length}`}</span>}
        </div>
        <div className="mb-6 rounded-lg border bg-card">
          <Table aria-label="Менеджеры" className="min-w-[720px] table-fixed">
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                {COLUMNS.map(([title, width]) => <TableHead key={title} scope="col" className={cn(headCell, width)}>{title}</TableHead>)}
                <TableHead scope="col" className={cn(headCell, 'w-32')}><span className="sr-only">Действия</span></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {firstLoad ? <><SkeletonRow /><SkeletonRow /><SkeletonRow /></> : visible.map(user => {
                const assigned = user.account_ids;
                const linked = accountList.filter(account => assigned.includes(account.id));
                const names = linked.slice(0, 2).map(account => account.username ? '@' + account.username : account.phone_e164 || `#${account.id}`).join(' · ') + (linked.length > 2 ? ` · ещё ${linked.length - 2}` : '');
                const note = [
                  user.user_id === me?.user_id && 'Это вы',
                  user.role === 'manager' && `Войсер: ${user.voicer_username || 'не назначен'}`,
                  user.role === 'voice' && (user.telegram_linked ? 'Telegram подключён' : 'Telegram не подключён'),
                ].filter(Boolean).join(' · ');
                const self = user.user_id === me?.user_id;
                return (
                  <TableRow key={user.user_id} data-manager-id={user.user_id}>
                    <TableCell className={cell}>
                      <div className={cn(line, 'font-medium')} title={user.username}>{user.username}</div>
                      <div className={cn(subline, 'min-h-4')} title={note || undefined}>{note}</div>
                    </TableCell>
                    <TableCell className={cell}>
                      <Badge variant={user.role === 'admin' ? 'secondary' : 'outline'}>{roles[user.role] || user.role}</Badge>
                    </TableCell>
                    <TableCell className={cn(cell, 'text-sm tabular-nums')}>
                      {user.region_code || <span className="text-muted-foreground">не задан</span>}
                    </TableCell>
                    <TableCell className={cell}>
                      {user.role === 'manager' ? <>
                        <div className={cn(line, 'tabular-nums')}>{`Назначено: ${assigned.length}`}</div>
                        <div className={cn(subline, 'min-h-4')} title={names || undefined}>{names}</div>
                      </> : <span className={caption}>{user.role === 'admin' ? 'Доступ ко всем' : '—'}</span>}
                    </TableCell>
                    <TableCell className={cell}>
                      <div className="flex items-center justify-end gap-0.5">
                        {user.role === 'manager' && <IconAction icon={Users} label={`Назначить аккаунты: ${user.username}`} hint="Назначить аккаунты" disabled={pending || opening !== null} onClick={() => openAccounts(user)} />}
                        {user.role === 'voice' && <VoiceBotLink compact userId={user.user_id} linked={user.telegram_linked} />}
                        <IconAction icon={Pencil} label="Изменить" disabled={pending} onClick={() => setEditing(user)} />
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <IconAction icon={MoreHorizontal} label="Ещё" />
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem disabled={pending || opening !== null} onSelect={() => showCredentials(user)}>
                              <KeyRound aria-hidden="true" />Логин и пароль
                            </DropdownMenuItem>
                            {!self && <>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem variant="destructive" disabled={pending} onSelect={() => remove(user)}>
                                <Trash2 aria-hidden="true" />Удалить
                              </DropdownMenuItem>
                            </>}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
              {!firstLoad && !visible.length && (
                <TableRow className="hover:bg-transparent">
                  <TableCell colSpan={COLUMNS.length + 1} className="h-[52px] px-3 text-center text-sm text-muted-foreground">
                    {loading || error ? '' : 'Ничего не найдено. Измените поиск.'}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
        {creating && <CreateForm roleList={data.roles} voicerList={voicerList} onCreate={create} onCancel={() => setCreating(false)} />}
        {credentials && <Credentials value={credentials} onClose={() => setCredentials(null)} onRegenerate={regenerate} />}
        {editing && <ManagerEditor key={editing.user_id} user={editing} me={me} roleList={data.roles} voicerList={voicerList} onSave={save} onClose={() => setEditing(null)} />}
        {assigning && <AccountAssignment key={assigning.user_id} user={assigning} userList={managerList} accountList={accountList} onSave={save} onClose={() => setAssigning(null)} />}
      </div>
    </>
  );
}

export default ManagersPage;
