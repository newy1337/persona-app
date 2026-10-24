import { useCallback, useEffect, useRef, useState } from 'react';
import { Eye, EyeOff, Pencil, Trash2 } from 'lucide-react';
import { api } from '../../api/client';
import { getAccounts as loadAccounts } from '../../api/accounts';
import { PanelUX as ux } from '../../ui/PanelUX';
import { VoiceBotLink } from '../VoiceWork/VoiceBotLink';
import { PhotoCell, RegionStopButton, usePhotoAssignments } from '../PhotoSets/StaffAssignments';
import { OwnRegionReassign } from '../../ui/ReassignSwitch';
import PickerModal from '../../ui/PickerModal';
import { LEAD_ROLE_FOR, ROLE_LABELS } from '../../utils/roles';
import { useRouteBusy } from '@/components/AppLayout/routeBusy';
import { IconAction } from '@/components/IconAction/IconAction';
import { PageHeader } from '@/components/PageHeader/PageHeader';
import { SearchInput } from '@/components/SearchInput/SearchInput';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { DialogError } from '@/components/ui/dialog';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { NativeCheckbox } from '@/components/ui/native-checkbox';
import { NativeSelect } from '@/components/ui/native-select';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { cn } from '@/lib/utils';

const roles = ROLE_LABELS;
// Роли, которым нужен регион (как в рабочей панели).
const REGION_ROLES = ['manager', 'teamlead', 'head'];
const validRegion = value => /^\d{3,4}$/.test(value);
const PASSWORD_MIN = 8; // как проверяет сервер
const errorText = e => {
  const message = e.detail || e.message || 'Не удалось выполнить действие';
  return Array.isArray(message) ? message.join('; ') : String(message);
};
const caption = 'text-xs text-muted-foreground';
const formGrid = 'grid gap-3 sm:grid-cols-2';
const sectionTitle = 'text-sm font-medium';

/* Колонки списка. Строка — две строки текста (20 + 16) и отступы по 8px: 52px. */
const COLUMNS = [['Учётка', ''], ['Роль', 'w-28'], ['Регион', 'w-20'], ['Аккаунты', 'w-[24%]'], ['Образ', 'w-[22%]']];
const headCell = 'h-9 px-3 text-xs font-medium text-muted-foreground';
const cell = 'px-3 py-2';
const line = 'truncate text-sm leading-5';
const subline = cn(caption, 'truncate leading-4');

/* Единственная строка ошибки окна — над кнопками подвала. Место занято всегда, длинный текст
   обрезается до одной строки (целиком — в подсказке), поэтому кнопки не двигаются. */
function FooterError({ children }) {
  const text = children || '';
  return <DialogError className="mb-0 w-full truncate" role={text ? 'alert' : undefined} title={text || undefined}>{text}</DialogError>;
}

/** Сколько человек в команде тимлида или хеда — вниз по цепочке руководителей. */
export function teamSize(user, users) {
  const seen = new Set([user.user_id]);
  let frontier = [user.user_id];
  while (frontier.length) {
    frontier = users.filter(u => frontier.includes(u.lead_id) && !seen.has(u.user_id)).map(u => u.user_id);
    for (const id of frontier) seen.add(id);
  }
  return seen.size - 1;
}

/* Руководитель: менеджеру выбирают тимлида своего региона (или напрямую хеду),
   тимлиду хед региона назначается сам. */
function LeadSelect({ role, region, userList, value, onChange, disabled, selfId = null }) {
  const wanted = LEAD_ROLE_FOR[role];
  if (!wanted) return null;
  const sameRegion = userList.filter(u => u.role === wanted && u.user_id !== selfId && (!region || u.region_code === region));
  if (role === 'teamlead') {
    const head = sameRegion[0];
    return (
      <p className={cn(caption, 'sm:col-span-2')} data-testid="auto-head">
        {region
          ? head ? `Хед региона ${region}: ${head.username} — назначается автоматически.` : `В регионе ${region} пока нет хеда: тимлид привяжется к нему, как только хед появится.`
          : 'Укажите регион — хед региона назначится автоматически.'}
      </p>
    );
  }
  const head = userList.find(u => u.role === 'head' && region && u.region_code === region);
  const hint = region
    ? sameRegion.length ? 'Тимлид видит диалоги и лидов своих менеджеров.' : `В регионе ${region} пока нет тимлидов${head ? ', менеджеры подчиняются хеду напрямую' : ''}.`
    : 'Сначала укажите регион.';
  return (
    <Field label="Тимлид" hint={hint}>
      <NativeSelect name="lead" aria-label="Руководитель" value={value} disabled={disabled || !region} onChange={e => onChange(e.target.value)}>
        <option value="">{head ? `Без тимлида — напрямую хеду ${head.username}` : 'Не назначен'}</option>
        {sameRegion.map(u => <option key={u.user_id} value={u.user_id}>{u.username}</option>)}
      </NativeSelect>
    </Field>
  );
}

function VoicerSelect({ voicerList, value, onChange, disabled }) {
  return (
    <Field label="Войсер" hint="Назначение применяется к новым заданиям.">
      <NativeSelect name="voicer" value={value} disabled={disabled} onChange={e => onChange(e.target.value)}>
        <option value="">Не назначен</option>
        {voicerList.map(v => <option key={v.user_id} value={v.user_id}>{`${v.username}${v.telegram_linked ? '' : ' · Telegram не подключён'}`}</option>)}
      </NativeSelect>
    </Field>
  );
}

function RoleSelect({ roleList, value, onChange, disabled }) {
  return (
    <Field label="Роль">
      <NativeSelect name="role" value={value} disabled={disabled} onChange={e => onChange(e.target.value)}>
        {roleList.map(r => <option key={r} value={r}>{roles[r] || r}</option>)}
      </NativeSelect>
    </Field>
  );
}

function CreateForm({ roleList, voicerList, userList = [], donors = [], onCreate, onCancel }) {
  const [username, setUsername] = useState('');
  const [role, setRole] = useState('manager');
  const [region, setRegion] = useState('');
  const [voicer, setVoicer] = useState('');
  const [lead, setLead] = useState('');
  const [donorIds, setDonorIds] = useState(() => new Set());
  const [pickingDonors, setPickingDonors] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const needsRegion = REGION_ROLES.includes(role);
  const valid = Boolean(username.trim()) && (!needsRegion || validRegion(region));
  async function submit(e) {
    e.preventDefault();
    if (!valid || busy) return;
    setBusy(true); setError('');
    try {
      await onCreate({
        username: username.trim(), role,
        ...(region ? { region_code: region } : {}),
        ...(role === 'manager' ? { voicer_id: voicer ? Number(voicer) : null } : {}),
        ...(LEAD_ROLE_FOR[role] ? { lead_id: lead ? Number(lead) : null } : {}),
        ...(role === 'manager' && donorIds.size ? { donor_ids: [...donorIds] } : {}),
      });
    }
    catch (e) { setError(errorText(e)); }
    finally { setBusy(false); }
  }
  return (
    <ux.Modal title="Новая учётка" onClose={onCancel} busy={busy} footer={<>
      <FooterError>{error}</FooterError>
      <Button type="button" variant="outline" disabled={busy} onClick={onCancel}>Отмена</Button>
      <Button type="submit" form="manager-create" disabled={!valid || busy}>{busy ? 'Создаём…' : 'Создать'}</Button>
    </>}>
      <form id="manager-create" onSubmit={submit} aria-label="Создание учётки" className={formGrid}>
        <Field label="Логин" className="sm:col-span-2">
          <Input value={username} data-autofocus required maxLength={64} autoComplete="off" disabled={busy} onChange={e => setUsername(e.target.value)} />
        </Field>
        <RoleSelect roleList={roleList} value={role} disabled={busy} onChange={setRole} />
        <Field label="Регион (3–4 цифры)">
          <Input type="text" inputMode="numeric" pattern="[0-9]{3,4}" maxLength={4} required={needsRegion} placeholder="Например, 077" disabled={busy} value={region} onChange={e => setRegion(e.target.value.replace(/\D/g, '').slice(0, 4))} />
        </Field>
        {role === 'manager' && <div className="sm:col-span-2"><VoicerSelect voicerList={voicerList} value={voicer} disabled={busy} onChange={setVoicer} /></div>}
        <LeadSelect role={role} region={region} userList={userList} value={lead} onChange={setLead} disabled={busy} />
        {role === 'manager' && donors.length > 0 && (
          <Field label="Доноры" className="sm:col-span-2" data-testid="create-donors" hint="Чьих лидов принимает по API. Онлайн, лимит и источники — на странице LeadGet.">
            <Button type="button" variant="outline" size="sm" className="justify-self-start" disabled={busy} onClick={() => setPickingDonors(true)}>
              {donorIds.size ? `Выбрано: ${donorIds.size}` : 'Любые — выбрать'}
            </Button>
          </Field>
        )}
        <p className={cn(caption, 'sm:col-span-2')}>Пароль создастся автоматически. После создания можно скопировать логин и пароль.</p>
      </form>
      {pickingDonors && <PickerModal title="Доноры нового менеджера" items={donors} value={donorIds} onSave={async ids => setDonorIds(new Set(ids))} onClose={() => setPickingDonors(false)} anyHint="Ничего не выбрано — принимает лидов любых доноров." />}
    </ux.Modal>
  );
}

const PASSWORD_MASK = '•'.repeat(12);
const NOT_STORED = 'Не сохранён для просмотра — создайте новый.';
const PASSWORD_PLACEHOLDER = { loading: 'Загружаем…', failed: '—', ready: 'Не сохранён' };

/* Сохранённый пароль: скрыт, пока не нажмут «Показать пароль». Поле обычное текстовое (не password),
   скрытое значение заменяют точки — браузер и менеджер паролей не считают его полем учётных данных.
   status: loading — ответа ещё нет, failed — загрузка не удалась (про пароль ничего не известно:
   прочерк и никаких подсказок), ready — ответ пришёл; «не сохранён» пишем только в этом случае.
   reserve держит строку подсказки с самого начала: её появление после загрузки ничего не двигает. */
function StoredPassword({ label, value, status = 'ready', reserve = false, visible, onToggle, className }) {
  const missing = status === 'ready' && !value;
  return (
    <Field label={label} className={className} reserve={reserve} hint={missing ? <span className="block truncate" title={NOT_STORED}>{NOT_STORED}</span> : undefined}>
      <span className="flex items-center gap-1.5">
        <Input name="current-password" className="font-mono" readOnly type="text" autoComplete="off" spellCheck={false} data-masked={value && !visible ? '' : undefined} value={value ? visible ? value : PASSWORD_MASK : ''} placeholder={PASSWORD_PLACEHOLDER[status]} />
        <IconAction icon={visible ? EyeOff : Eye} label={visible ? 'Скрыть пароль' : 'Показать пароль'} size="icon" variant="outline" disabled={!value} onClick={onToggle} />
      </span>
    </Field>
  );
}

/* Кнопка держит ширину длинной подписи: смена на «Скопировано» ничего не двигает.
   onError получает только ошибку самого копирования ('' — её больше нет); чужие ошибки окна не трогает. */
function CopyCredentials({ value, onError, ...props }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => { setCopied(false); }, [value?.username, value?.password]);
  async function copy() {
    try {
      await navigator.clipboard.writeText(`Логин: ${value.username}\nПароль: ${value.password}${value.region_code ? `\nРегион: ${value.region_code}` : ''}`);
      setCopied(true); onError('');
    } catch { setCopied(false); onError('Не удалось скопировать. Нажмите «Показать пароль» и скопируйте данные из полей.'); }
  }
  return <Button type="button" className="min-w-[14.5rem]" disabled={!value?.password} onClick={copy} {...props}>{copied ? 'Скопировано' : 'Копировать логин + пароль'}</Button>;
}

/* Данные новой учётки — один раз сразу после создания. Дальше всё то же самое лежит в «Изменить». */
function CreatedCredentials({ value, onClose }) {
  const [visible, setVisible] = useState(false), [error, setError] = useState('');
  return (
    <ux.Modal title={`Данные для входа: ${value.username}`} onClose={onClose} footer={<>
      <FooterError>{error}</FooterError>
      <Button type="button" variant="outline" onClick={onClose}>Закрыть</Button>
      <CopyCredentials data-autofocus value={value} onError={setError} />
    </>}>
      <div className={formGrid}>
        <Field label="Логин для входа">
          <Input className="font-mono" readOnly value={value.username} />
        </Field>
        <Field label="Регион">
          <Input className="font-mono" readOnly value={value.region_code || 'Не задан'} />
        </Field>
        <StoredPassword className="sm:col-span-2" label="Пароль для входа" value={value.password} visible={visible} onToggle={() => setVisible(!visible)} />
      </div>
    </ux.Modal>
  );
}

/* Раздел «Аккаунты» окна учётки. Выбор хранит сама форма: аккаунты сохраняются вместе с остальным. */
function AccountPicker({ userId, accountList, ownerById, selected, moving, disabled, onToggle }) {
  const [query, setQuery] = useState(''), [filter, setFilter] = useState('all');
  const q = query.toLowerCase().trim(), phoneQuery = query.replace(/[^0-9]/g, '');
  const matched = accountList.filter(account => {
    if (filter === 'selected' && !selected.has(account.id)) return false;
    if (filter === 'free' && ownerById.has(account.id)) return false;
    return !q || [account.username, account.display_name, account.phone_e164, ownerById.get(account.id)?.username, String(account.id)].some(value => String(value || '').toLowerCase().includes(q)) || phoneQuery.length >= 3 && /^[+()\s\d-]+$/.test(query) && (account.phone_e164 || '').includes(phoneQuery);
  });
  return (
    <section className="grid gap-3" data-enter="keep">
      <div className="flex items-baseline justify-between gap-3">
        <h3 className={sectionTitle}>Аккаунты</h3>
        <span className={cn(caption, 'min-w-[12ch] text-right tabular-nums')} role="status">{`Выбрано: ${selected.size}`}</span>
      </div>
      <div className="flex min-h-8 flex-wrap items-center gap-2">
        <div className="flex items-center gap-0.5" role="group" aria-label="Какие аккаунты показать">
          {[['all', 'Все'], ['selected', 'Выбранные'], ['free', 'Свободные']].map(([key, label]) => (
            <Button key={key} type="button" size="sm" variant={filter === key ? 'secondary' : 'ghost'} className={cn('shadow-none', filter !== key && 'text-muted-foreground')} aria-pressed={filter === key} onClick={() => setFilter(key)}>{label}</Button>
          ))}
        </div>
        <SearchInput className="ml-auto w-full sm:w-72" aria-label="Поиск аккаунтов" placeholder="Номер, ник, имя или менеджер" value={query} onChange={setQuery} />
      </div>
      {/* Высота списка постоянная: поиск и фильтр не меняют высоту окна. */}
      <div className={cn('mr-assignment-list', 'h-60 divide-y overflow-y-auto overscroll-contain rounded-md border [scrollbar-gutter:stable]')}>
        {matched.length ? matched.map(account => {
          const owner = ownerById.get(account.id);
          return (
            <label key={account.id} className="grid cursor-pointer grid-cols-[1rem_minmax(0,1fr)_minmax(90px,30%)] items-center gap-3 px-3 py-2 hover:bg-muted/50">
              <NativeCheckbox disabled={disabled} checked={selected.has(account.id)} aria-label={`Аккаунт ${account.phone_e164 || account.username || account.id}`} onChange={e => onToggle(account.id, e.target.checked)} />
              <span className="flex min-w-0 flex-col">
                <span className={line}>{account.display_name || account.username || account.phone_e164 || `#${account.id}`}</span>
                <span className={cn(subline, 'font-mono')}>{[account.phone_e164, account.username ? '@' + account.username : null].filter(Boolean).join(' · ')}</span>
              </span>
              <span className={cn(caption, 'truncate text-right')}>{owner ? owner.user_id === userId ? 'У этого менеджера' : owner.username : 'Свободен'}</span>
            </label>
          );
        }) : <p className={cn(caption, 'p-3')}>Аккаунты не найдены. Измените поиск или фильтр.</p>}
      </div>
      <div className={cn(caption, 'flex min-h-4 items-center gap-1.5')}>{moving.length > 0 && <>
        <span className="size-1.5 shrink-0 rounded-full bg-warning-foreground" aria-hidden="true" />
        <p>{`Будут переназначены от других менеджеров: ${moving.length}`}</p>
      </>}</div>
    </section>
  );
}

// Enter в поиске и на галочках списка аккаунтов не должен отправлять всю форму учётки.
const keepEnter = event => { if (event.key === 'Enter' && event.target.tagName === 'INPUT' && event.target.closest('[data-enter="keep"]')) event.preventDefault(); };
const draftOf = user => ({ username: user.username, role: user.role, region: user.region_code || '', voicer: String(user.voicer_id || ''), lead: String(user.lead_id || ''), photoEdit: Boolean(user.can_edit_photo_sets), password: '', selected: new Set(user.account_ids) });

/* Одно окно на всю учётку: основное, вход и аккаунты. Открывается сразу с данными строки (поля
   заблокированы), запрос логина и пароля (GET :id/credentials) разблокирует их — размер окна
   при этом не меняется. «Сохранить» отправляет одним запросом только то, что изменилось.
   leadOnly — окно хеда: он только назначает тимлида менеджеру своего региона, входа и
   аккаунтов там нет. */
function ManagerEditor({ user, me, roleList, voicerList, userList, accountList, onSave, onRegenerate, onClose, leadOnly = false }) {
  const [saved, setSaved] = useState(null), [draft, setDraft] = useState(() => draftOf(user));
  const [loadError, setLoadError] = useState(''), [attempt, setAttempt] = useState(0);
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [visible, setVisible] = useState(false);
  // Ошибка копирования живёт отдельно: удачное копирование не стирает ошибку сохранения.
  const [copyError, setCopyError] = useState(''), [regenerating, setRegenerating] = useState(false);
  const lock = useRef(false);
  useEffect(() => {
    if (leadOnly) { setSaved(user); return undefined; }
    let alive = true;
    api.get(`/api/managers/${user.user_id}/credentials`).then(
      value => { if (alive) { const fresh = { ...user, ...value }; setSaved(fresh); setDraft(draftOf(fresh)); } },
      e => { if (alive) setLoadError(ux.readableError(e)); },
    );
    return () => { alive = false; };
  }, [user, leadOnly, attempt]);
  const base = saved || user;
  const locked = busy || !saved;
  const set = patch => setDraft(current => ({ ...current, ...patch }));
  const login = draft.username.trim();
  const assigned = base.account_ids;
  const leavesManagers = base.role === 'manager' && draft.role !== 'manager';
  // Чей аккаунт сейчас: по списку страницы, а для этой учётки — по свежему ответу сервера.
  const ownerById = new Map();
  for (const manager of userList) if (manager.role === 'manager' && manager.user_id !== base.user_id) for (const id of manager.account_ids) ownerById.set(id, manager);
  if (base.role === 'manager') for (const id of assigned) ownerById.set(id, base);
  const moving = draft.role === 'manager' ? accountList.filter(account => draft.selected.has(account.id) && ownerById.has(account.id) && ownerById.get(account.id).user_id !== base.user_id) : [];
  const voicerId = draft.voicer ? Number(draft.voicer) : null;
  const leadId = LEAD_ROLE_FOR[draft.role] && draft.lead ? Number(draft.lead) : null;
  const body = {};
  if (leadOnly) {
    if (leadId !== (base.lead_id ?? null)) body.lead_id = leadId;
  } else {
    if (login !== base.username) body.username = login;
    if (draft.role !== base.role) body.role = draft.role;
    if (draft.region !== (base.region_code || '')) body.region_code = draft.region || null;
    if (draft.role === 'manager' && voicerId !== (base.voicer_id ?? null)) body.voicer_id = voicerId;
    if (LEAD_ROLE_FOR[draft.role] && leadId !== (base.lead_id ?? null) || draft.role !== base.role && LEAD_ROLE_FOR[draft.role]) body.lead_id = leadId;
    if (draft.photoEdit !== Boolean(base.can_edit_photo_sets)) body.can_edit_photo_sets = draft.photoEdit;
    if (leavesManagers) body.account_ids = [];
    else if (draft.role === 'manager' && (draft.selected.size !== assigned.length || assigned.some(id => !draft.selected.has(id)))) body.account_ids = [...draft.selected].sort((a, b) => a - b);
    if (draft.password) body.password = draft.password;
  }
  const changed = Object.keys(body).length > 0;
  const regionValid = draft.region === '' ? !REGION_ROLES.includes(draft.role) || draft.role === base.role && !base.region_code : validRegion(draft.region);
  const passwordValid = !draft.password || draft.password.length >= PASSWORD_MIN;
  const valid = Boolean(login) && regionValid && passwordValid;
  async function save(event) {
    event.preventDefault();
    if (lock.current || !saved || !changed || !valid) return;
    lock.current = true;
    try {
      if (leavesManagers && assigned.length && !await ux.confirm({ title: 'Изменить роль?', message: `У ${base.username} будут освобождены аккаунты: ${assigned.length}.`, confirmLabel: 'Изменить роль' })) return;
      if (body.account_ids && moving.length && !await ux.confirm({ title: 'Переназначить аккаунты?', message: `Эти аккаунты перейдут к ${login}:\n` + moving.map(account => `${account.username ? '@' + account.username : account.phone_e164} — от ${ownerById.get(account.id).username}`).join('\n'), confirmLabel: 'Переназначить' })) return;
      setBusy(true); setError('');
      await onSave(base.user_id, body);
      onClose();
    } catch (e) { setError(ux.readableError(e)); }
    finally { lock.current = false; setBusy(false); }
  }
  // Новый пароль создаётся сразу, отдельно от «Сохранить»: остальные правки в форме остаются как были.
  async function regenerate() {
    if (lock.current || !saved) return;
    lock.current = true;
    try {
      if (!await ux.confirm({ title: 'Создать новый пароль?', message: `Учётка ${base.username}. Прежний пароль перестанет действовать.`, confirmLabel: 'Создать пароль' })) return;
      setBusy(true); setRegenerating(true); setError('');
      const fresh = await onRegenerate(base.user_id);
      if (fresh) { setSaved(current => ({ ...current, ...fresh })); setVisible(true); }
    } catch (e) { setError(ux.readableError(e)); }
    finally { lock.current = false; setBusy(false); setRegenerating(false); }
  }
  const toggle = (id, checked) => setDraft(current => { const selected = new Set(current.selected); if (checked) selected.add(id); else selected.delete(id); return { ...current, selected }; });
  return (
    <ux.Modal title={leadOnly ? `Тимлид: ${user.username}` : `Учётка: ${user.username}`} wide={!leadOnly} busy={busy} onClose={onClose} footer={<>
      {/* Одна строка для ошибки загрузки, сохранения и копирования — над кнопками. */}
      <FooterError>{loadError || error || copyError}</FooterError>
      <Button type="button" variant="outline" disabled={busy} onClick={onClose}>Отмена</Button>
      {loadError
        ? <Button type="button" className="min-w-28" onClick={() => { setLoadError(''); setAttempt(attempt + 1); }}>Повторить</Button>
        : <Button type="submit" form="manager-editor" className="min-w-28" disabled={locked || !changed || !valid}>{busy && !regenerating ? 'Сохраняем…' : 'Сохранить'}</Button>}
    </>}>
      <form id="manager-editor" className="grid gap-4" aria-busy={!saved && !loadError} onSubmit={save} onKeyDown={keepEnter}>
        <section className="grid gap-3">
          <h3 className={sectionTitle}>Основное</h3>
          <div className={formGrid}>
            <Field label="Логин" reserve error={login ? '' : 'Укажите логин.'}>
              {/* Пока идёт загрузка, поле только для чтения, но не выключено: фокус окна встаёт сюда. */}
              <Input name="username" data-autofocus={!leadOnly} required maxLength={64} autoComplete="off" readOnly={!saved || leadOnly} disabled={busy} value={draft.username} onChange={e => set({ username: e.target.value })} />
            </Field>
            <RoleSelect roleList={roleList} value={draft.role} disabled={locked || leadOnly || base.user_id === me?.user_id} onChange={role => set({ role })} />
            <Field label="Регион" reserve hint="3 или 4 цифры" error={regionValid ? '' : 'Укажите код региона: 3 или 4 цифры.'}>
              <Input name="region" value={draft.region} disabled={locked || leadOnly} inputMode="numeric" maxLength={4} placeholder="Например, 0077" onChange={e => set({ region: e.target.value.replace(/\D/g, '').slice(0, 4) })} />
            </Field>
            {draft.role === 'manager' && !leadOnly && <VoicerSelect voicerList={voicerList} value={draft.voicer} disabled={locked} onChange={voicer => set({ voicer })} />}
            <LeadSelect role={draft.role} region={draft.region} userList={userList} value={draft.lead} onChange={lead => set({ lead })} disabled={locked} selfId={base.user_id} />
            {!leadOnly && draft.role !== 'admin' && draft.role !== 'voice' && (
              <label className="flex cursor-pointer items-center gap-2 text-sm sm:col-span-2">
                <NativeCheckbox checked={draft.photoEdit} disabled={locked} onChange={e => set({ photoEdit: e.target.checked })} />
                Может менять образы
              </label>
            )}
          </div>
        </section>
        {!leadOnly && <>
        <Separator />
        <section className="grid gap-3">
          <h3 className={sectionTitle}>Вход</h3>
          <div className={formGrid}>
            <StoredPassword reserve label="Текущий пароль" value={saved?.password} status={saved ? 'ready' : loadError ? 'failed' : 'loading'} visible={visible} onToggle={() => setVisible(!visible)} />
            <Field label="Новый пароль" reserve hint="Необязательно. Заменит текущий после сохранения." error={passwordValid ? '' : `Не короче ${PASSWORD_MIN} символов.`}>
              <Input name="password" className="font-mono" autoComplete="new-password" spellCheck={false} maxLength={256} disabled={locked} value={draft.password} onChange={e => set({ password: e.target.value })} />
            </Field>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <CopyCredentials variant="outline" size="sm" value={saved} onError={setCopyError} />
            {/* Ход создания пароля показывает только эта кнопка; ширина — по длинной подписи. */}
            <Button type="button" variant="outline" size="sm" className="min-w-[11.5rem]" disabled={locked} onClick={regenerate}>{regenerating ? 'Создаём…' : 'Создать новый пароль'}</Button>
          </div>
        </section>
        {draft.role === 'manager' && <>
          <Separator />
          <AccountPicker userId={base.user_id} accountList={accountList} ownerById={ownerById} selected={draft.selected} moving={moving} disabled={locked} onToggle={toggle} />
        </>}
        </>}
      </form>
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
      <TableCell className={cell}><Skeleton className="h-3.5 w-28" /></TableCell>
      <TableCell className={cell}><div className="flex h-8 items-center justify-end"><Skeleton className="h-5 w-24" /></div></TableCell>
    </TableRow>
  );
}

export function ManagersPage() {
  const [data, setData] = useState({ roles: [], items: null }), [accountList, setAccountList] = useState([]), [me, setMe] = useState(null);
  const [error, setError] = useState(''), [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false), [created, setCreated] = useState(null), [editing, setEditing] = useState(null);
  const [query, setQuery] = useState('');
  const [donors, setDonors] = useState([]);
  useRouteBusy(loading);
  const reload = useCallback(async () => {
    const [fresh, accountRows, currentUser] = await Promise.all([api.get('/api/managers'), loadAccounts(), api.get('/auth/me')]);
    setData(fresh); setAccountList(accountRows); setMe(currentUser);
    if (currentUser?.role === 'admin') api.get('/api/donors').then(d => setDonors(Array.isArray(d?.items) ? d.items : [])).catch(() => setDonors([]));
    return fresh;
  }, []);
  useEffect(() => { reload().catch(e => setError(ux.readableError(e))).finally(() => setLoading(false)); }, [reload]);
  async function create(body) {
    const result = await api.post('/api/managers', body);
    setData(result); setCreating(false); setError('');
    // Пароль новой учётки показываем сразу после создания; позже он доступен в «Изменить».
    try { setCreated(await api.get(`/api/managers/${result.created_user_id}/credentials`)); }
    catch (e) { setError(ux.readableError(e)); }
  }
  // Ответ — свежий список (хеду — только его регион).
  async function save(id, body) {
    const list = await api.put(`/api/managers/${id}`, body);
    setData(list); setError('');
  }
  // Новый случайный пароль: ответ — логин, регион и пароль для окна учётки.
  async function regenerate(id) {
    return api.post(`/api/managers/${id}/password`, {});
  }
  async function remove(user) {
    if (!await ux.confirm({ title: `Удалить ${user.username}?`, message: 'Учётка будет удалена. Закреплённые аккаунты освободятся.', confirmLabel: 'Удалить', danger: true })) return;
    try { setData(await api.delete(`/api/managers/${user.user_id}`)); }
    catch (e) { setError(ux.readableError(e)); }
  }
  const state = ux.useActions(), pending = state.pending.some(key => key.includes('/api/managers'));
  const managerList = data.items || [];
  const voicerList = managerList.filter(u => u.role === 'voice');
  const admin = me?.role === 'admin';
  const photo = usePhotoAssignments(managerList.map(user => user.region_code));
  const needle = query.trim().toLowerCase();
  const visible = managerList.filter(user => [user.username, user.region_code, roles[user.role]].some(value => String(value || '').toLowerCase().includes(needle)));
  const firstLoad = loading && data.items === null;
  return (
    <>
      <div className="container">
        <PageHeader title={!me || admin ? 'Менеджеры' : `Моя команда · регион ${me.region_code || ''}`}>
          {me && !admin && <><OwnRegionReassign /><RegionStopButton /></>}
          {admin && <Button type="button" size="sm" onClick={() => { setCreating(true); setCreated(null); }}>+ Создать учётку</Button>}
        </PageHeader>
        <div className="mb-3 flex min-h-8 flex-wrap items-center gap-x-4 gap-y-2">
          {/* Одно место и для счётчика, и для ошибки страницы: список под ним не сдвигается. */}
          {error || photo.error
            ? <p className="min-w-0 flex-1 text-xs text-destructive" role="alert">{error || photo.error}</p>
            : <span className={cn(caption, 'min-w-[14ch] tabular-nums')}>{loading ? 'Загружаем…' : `Показано: ${visible.length}`}</span>}
          <SearchInput className="ml-auto w-full sm:w-80" aria-label="Поиск менеджеров" placeholder="Логин, регион или роль" value={query} onChange={setQuery} />
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
                  LEAD_ROLE_FOR[user.role] && `Руководитель: ${user.lead_username || 'не назначен'}`,
                  user.role === 'voice' && (user.telegram_linked ? 'Telegram подключён' : 'Telegram не подключён'),
                ].filter(Boolean).join(' · ');
                const canEdit = admin || user.role === 'manager';
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
                      </> : <span className={caption}>{user.role === 'admin' ? 'Доступ ко всем' : user.role === 'teamlead' || user.role === 'head' ? `Команда: ${teamSize(user, managerList)} чел.` : '—'}</span>}
                    </TableCell>
                    <TableCell className={cell}>
                      <PhotoCell user={user} photo={photo} />
                    </TableCell>
                    <TableCell className={cell}>
                      <div className="flex items-center justify-end gap-0.5">
                        {admin && user.role === 'voice' && <VoiceBotLink compact userId={user.user_id} linked={user.telegram_linked} />}
                        {canEdit && <IconAction icon={Pencil} label={admin ? 'Изменить' : 'Назначить тимлида'} disabled={pending} onClick={() => setEditing(user)} />}
                        {/* Свою учётку удалить нельзя; место кнопки занято, чтобы «Изменить» стояла в одной колонке. */}
                        {admin && (self
                          ? <span className="size-8 shrink-0" aria-hidden="true" />
                          : <IconAction icon={Trash2} label="Удалить" tone="danger" disabled={pending} onClick={() => remove(user)} />)}
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
        {creating && <CreateForm roleList={data.roles} voicerList={voicerList} userList={managerList} donors={donors} onCreate={create} onCancel={() => setCreating(false)} />}
        {created && <CreatedCredentials value={created} onClose={() => setCreated(null)} />}
        {editing && <ManagerEditor key={editing.user_id} user={editing} me={me} roleList={data.roles} voicerList={voicerList} userList={managerList} accountList={accountList} leadOnly={!admin} onSave={save} onRegenerate={regenerate} onClose={() => setEditing(null)} />}
      </div>
    </>
  );
}

export default ManagersPage;
