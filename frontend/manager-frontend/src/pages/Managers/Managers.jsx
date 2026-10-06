import React from 'react';
import { api } from '../../api/client';
import Nav from '../../components/Header/Header';
import s from '../../styles/AdminPage.module.scss';
import { getAccounts as loadAccounts } from '../../api/accounts';
import { PanelUX as ux } from '../../ui/PanelUX';
import { VoiceBotLink } from '../VoiceWork/VoiceBotLink';

const h = React.createElement;
const { useState, useEffect, useCallback } = React;
const roles = { admin: 'админ', manager: 'менеджер', voice: 'войсер' };
const validRegion = value => /^\d{3,4}$/.test(value);
const errorText = e => {
  const message = e.detail || e.message || 'Не удалось выполнить действие';
  return Array.isArray(message) ? message.join('; ') : String(message);
};
const button = (text, onClick, props = {}) => h('button', { type: 'button', className: s.btnSm, onClick, ...props }, text);

function VoicerSelect({ voicers, value, onChange, disabled }) {
  return h('label', { className: s.label }, 'Войсер', h('select', { className: s.select, value, disabled, onChange: e => onChange(e.target.value) },
    h('option', { value: '' }, 'Не назначен'), voicers.map(v => h('option', { key: v.user_id, value: v.user_id }, `${v.username}${v.telegram_linked ? '' : ' · Telegram не подключён'}`))), h('span', { className: 'mr-caption' }, 'Назначение применяется к новым заданиям.'));
}

function CreateForm({ availableRoles, voicers, onCreate, onCancel }) {
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
  return h('form', { onSubmit: submit, className: 'mr-create', 'aria-label': 'Создание учётки' },
    h('label', { className: s.label }, 'Логин', h('input', { className: s.field, value: username, autoFocus: true, required: true, maxLength: 64, autoComplete: 'off', onChange: e => setUsername(e.target.value) })),
    h('label', { className: s.label }, 'Роль', h('select', { className: s.select, value: role, onChange: e => setRole(e.target.value) }, availableRoles.map(r => h('option', { key: r, value: r }, roles[r] || r)))),
    h('label', { className: s.label }, 'Регион (3–4 цифры)', h('input', { className: s.field, type: 'text', inputMode: 'numeric', pattern: '[0-9]{3,4}', maxLength: 4, required: role === 'manager', placeholder: 'Например, 077', value: region, onChange: e => setRegion(e.target.value.replace(/\D/g, '').slice(0, 4)) })),
    role === 'manager' && h(VoicerSelect, { voicers, value: voicer, onChange: setVoicer }),
    h('p', { className: 'mr-full mr-caption' }, 'Пароль создастся автоматически. После создания можно скопировать логин и пароль.'),
    error && h('p', { className: `${s.error} mr-full`, role: 'alert' }, error),
    h('div', { className: `${s.actions} mr-full` },
      h('button', { className: s.btnPrimary, type: 'submit', disabled: !valid || busy }, busy ? 'Создаём…' : 'Создать'),
      button('Отмена', onCancel, { disabled: busy })));
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
  return h('section', { className: 'mr-credentials', 'aria-label': 'Данные для входа' },
    h('div', { className: s.head }, h('h3', null, `Данные для входа: ${value.username}`), button('Закрыть', onClose)),
    h('div', { className: 'mr-create' },
      h('label', { className: s.label }, 'Логин для входа', h('input', { className: s.field, readOnly: true, value: value.username })),
      h('label', { className: s.label }, 'Регион', h('input', { className: s.field, readOnly: true, value: value.region_code || 'Не задан' })),
      value.password ? h('label', { className: s.label }, 'Пароль для входа', h('input', { className: s.field, readOnly: true, autoComplete: 'off', type: visible ? 'text' : 'password', value: value.password })) :
        h('p', { className: 'mr-full mr-caption' }, 'Пароль этой старой учётки не сохранён для просмотра. Можно создать новый и выдать его менеджеру.')),
    h('div', { className: s.actions },
      value.password && button(visible ? 'Скрыть пароль' : 'Показать пароль', () => setVisible(!visible)),
      value.password && button(copied ? 'Скопировано' : 'Копировать логин + пароль', copy),
      button(busy ? 'Создаём…' : 'Создать новый пароль', regenerate, { disabled: busy })),
    error && h('p', { className: s.error, role: 'alert' }, error));
}

function ManagerEditor({ user, me, availableRoles, voicers, onSave, onClose }) {
  const [role, setRole] = useState(user.role), [region, setRegion] = useState(user.region_code || '');
  const [voicer, setVoicer] = useState(String(user.voicer_id || ''));
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const lock = React.useRef(false);
  const changed = role !== user.role || region !== (user.region_code || '') || voicer !== String(user.voicer_id || '');
  const valid = region === '' ? role !== 'manager' || user.role === 'manager' && !user.region_code : validRegion(region);
  async function save(event) {
    event.preventDefault();
    if (lock.current || !changed || !valid) return;
    lock.current = true;
    if (user.role === 'manager' && role !== 'manager' && user.account_ids.length && !await ux.confirm({ title: 'Изменить роль?', message: `У ${user.username} будут освобождены аккаунты: ${user.account_ids.length}.`, confirmLabel: 'Изменить роль' })) { lock.current = false; return; }
    setBusy(true); setError('');
    try {
      await onSave(user.user_id, { role, region_code: region || null, voicer_id: role === 'manager' && voicer ? Number(voicer) : null, ...(user.role === 'manager' && role !== 'manager' ? { account_ids: [] } : {}) });
      onClose();
    } catch (e) { setError(ux.readableError(e)); }
    finally { lock.current = false; setBusy(false); }
  }
  return h(ux.Modal, { title: `Учётка: ${user.username}`, onClose, busy, footer: h(React.Fragment, null,
    button('Отмена', onClose, { disabled: busy }),
    h('button', { type: 'submit', form: 'manager-editor', className: s.btnPrimary, disabled: !changed || !valid || busy }, busy ? 'Сохраняем…' : 'Сохранить')) },
    h('form', { id: 'manager-editor', className: 'mr-manager-form', onSubmit: save },
      h('label', { className: s.label }, 'Роль', h('select', { className: s.select, value: role, disabled: busy || user.user_id === me?.user_id, onChange: e => setRole(e.target.value) }, availableRoles.map(r => h('option', { key: r, value: r }, roles[r] || r)))),
      h('label', { className: s.label }, 'Регион (3–4 цифры)', h('input', { className: s.field, 'data-autofocus': true, value: region, disabled: busy, inputMode: 'numeric', maxLength: 4, placeholder: 'Например, 0077', onChange: e => setRegion(e.target.value.replace(/\D/g, '').slice(0, 4)) })),
      role === 'manager' && h(VoicerSelect, { voicers, value: voicer, onChange: setVoicer, disabled: busy }),
      !valid && h('p', { className: 'ux-inline-error' }, 'Укажите код региона: 3 или 4 цифры.'),
      error && h('p', { className: 'ux-inline-error', role: 'alert' }, error)));
}

function AccountAssignment({ user, users, accounts, onSave, onClose }) {
  const [selected, setSelected] = useState(() => new Set(user.account_ids));
  const [query, setQuery] = useState(''), [filter, setFilter] = useState('all');
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const lock = React.useRef(false);
  const owners = new Map();
  for (const manager of users) if (manager.role === 'manager') for (const id of manager.account_ids) owners.set(id, manager);
  const changed = selected.size !== user.account_ids.length || user.account_ids.some(id => !selected.has(id));
  const q = query.toLowerCase().trim(), phoneQuery = query.replace(/[^0-9]/g, '');
  const rows = accounts.filter(account => {
    if (filter === 'selected' && !selected.has(account.id)) return false;
    if (filter === 'free' && owners.has(account.id)) return false;
    return !q || [account.username, account.display_name, account.phone_e164, owners.get(account.id)?.username, String(account.id)].some(value => String(value || '').toLowerCase().includes(q)) || phoneQuery.length >= 3 && /^[+()\s\d-]+$/.test(query) && (account.phone_e164 || '').includes(phoneQuery);
  });
  const moving = accounts.filter(account => selected.has(account.id) && owners.has(account.id) && owners.get(account.id).user_id !== user.user_id);
  async function save() {
    if (lock.current || !changed) return;
    lock.current = true;
    if (moving.length && !await ux.confirm({ title: 'Переназначить аккаунты?', message: `Эти аккаунты перейдут к ${user.username}:\n` + moving.map(account => `${account.username ? '@' + account.username : account.phone_e164} — от ${owners.get(account.id).username}`).join('\n'), confirmLabel: 'Переназначить' })) { lock.current = false; return; }
    setBusy(true); setError('');
    try { await onSave(user.user_id, { account_ids: [...selected] }); onClose(); }
    catch (e) { setError(ux.readableError(e)); }
    finally { lock.current = false; setBusy(false); }
  }
  return h(ux.Modal, { title: `Аккаунты: ${user.username}`, wide: true, busy, onClose, footer: h(React.Fragment, null,
    h('span', { className: 'mr-assignment-count', role: 'status' }, `Выбрано: ${selected.size}`),
    button('Отмена', onClose, { disabled: busy }),
    button(busy ? 'Сохраняем…' : 'Сохранить', save, { className: s.btnPrimary, disabled: !changed || busy })) },
    h('input', { className: s.field, type: 'search', 'aria-label': 'Поиск аккаунтов', placeholder: 'Номер, ник, имя или менеджер', 'data-autofocus': true, value: query, onChange: e => setQuery(e.target.value) }),
    h('div', { className: 'mr-assignment-filters' }, [['all', 'Все'], ['selected', 'Выбранные'], ['free', 'Свободные']].map(([key, label]) => button(label, () => setFilter(key), { key, className: `${s.btnSm} ${filter === key ? s.btnSelected : ''}`, 'aria-pressed': filter === key }))),
    h('div', { className: 'mr-assignment-list' }, rows.length ? rows.map(account => {
      const owner = owners.get(account.id);
      return h('label', { key: account.id, className: `mr-assignment-item ${selected.has(account.id) ? 'mr-assignment-selected' : ''}` },
        h('input', { type: 'checkbox', disabled: busy, checked: selected.has(account.id), 'aria-label': `Аккаунт ${account.phone_e164 || account.username || account.id}`, onChange: e => { const checked = e.target.checked; setSelected(previous => { const next = new Set(previous); if (checked) next.add(account.id); else next.delete(account.id); return next; }); } }),
        h('span', { className: 'mr-assignment-identity' }, h('strong', null, account.display_name || account.username || account.phone_e164 || `#${account.id}`), h('span', null, [account.phone_e164, account.username ? '@' + account.username : null].filter(Boolean).join(' · '))),
        h('span', { className: 'mr-assignment-owner' }, owner ? owner.user_id === user.user_id ? 'У этого менеджера' : owner.username : 'Свободен'));
    }) : h('p', { className: 'mr-caption' }, 'Аккаунты не найдены. Измените поиск или фильтр.')),
    moving.length > 0 && h('p', { className: 'mr-assignment-warning' }, `Будут переназначены от других менеджеров: ${moving.length}`),
    error && h('p', { className: 'ux-inline-error', role: 'alert' }, error));
}

export function ManagersPage() {
  const [data, setData] = useState({ roles: [], items: [] }), [accounts, setAccounts] = useState([]), [me, setMe] = useState(null);
  const [error, setError] = useState(''), [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false), [credentials, setCredentials] = useState(null), [editing, setEditing] = useState(null), [assigning, setAssigning] = useState(null);
  const [query, setQuery] = useState('');
  const [opening, setOpening] = useState(null);
  const reload = useCallback(async () => {
    const [users, accountRows, currentUser] = await Promise.all([api.get('/api/managers'), loadAccounts(), api.get('/auth/me')]);
    setData(users); setAccounts(accountRows); setMe(currentUser); return { users, accountRows };
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
    try { const fresh = await reload(); const current = fresh.users.items.find(item => item.user_id === user.user_id); if (current?.role === 'manager') setAssigning(current); }
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
  const visible = data.items.filter(user => [user.username, user.region_code, roles[user.role]].some(value => String(value || '').toLowerCase().includes(query.trim().toLowerCase())));
  return h('div', { className: 'app mr-managers' }, h(Nav), h('main', { className: 'main' }, h('div', { className: 'container' },
    h('div', { className: s.head }, h('h2', { className: s.title }, 'Менеджеры'), !creating && button('+ Создать учётку', () => { setCreating(true); setCredentials(null); }, { className: s.btnPrimary })),
    creating && h(CreateForm, { availableRoles: data.roles, voicers: data.items.filter(u => u.role === 'voice'), onCreate: create, onCancel: () => setCreating(false) }),
    error && h('p', { className: s.error, role: 'alert' }, error),
    credentials && h(Credentials, { value: credentials, onClose: () => setCredentials(null), onRegenerate: regenerate }),
    h('div', { className: 'mr-manager-toolbar' }, h('input', { className: s.field, type: 'search', 'aria-label': 'Поиск менеджеров', placeholder: 'Логин, регион или роль', value: query, onChange: e => setQuery(e.target.value) }), h('span', { className: 'mr-caption' }, loading ? 'Загружаем…' : `Показано: ${visible.length}`)),
    h('table', { className: 'mr-manager-table', 'aria-label': 'Менеджеры' },
      h('thead', null, h('tr', null, ['Учётка', 'Роль / регион', 'Аккаунты', 'Действия'].map((title, index) => h('th', { key: title, scope: 'col', style: { width: ['22%', '18%', '28%', '32%'][index] } }, title)))),
      h('tbody', null, visible.map(user => {
        const linked = accounts.filter(account => user.account_ids.includes(account.id));
        return h('tr', { key: user.user_id, 'data-manager-id': user.user_id },
          h('td', { className: 'mr-manager-identity' }, h('strong', null, user.username), user.user_id === me?.user_id && h('span', { className: 'mr-caption' }, 'Это вы'), user.role === 'manager' && h('span', { className: 'mr-caption' }, `Войсер: ${user.voicer_username || 'не назначен'}`), user.role === 'voice' && h('span', { className: 'mr-caption' }, user.telegram_linked ? 'Telegram подключён' : 'Telegram не подключён')),
          h('td', { className: 'mr-manager-role' }, h('span', null, roles[user.role] || user.role), h('span', { className: 'mr-caption' }, user.region_code ? `Регион ${user.region_code}` : 'Регион не задан')),
          h('td', { className: 'mr-manager-accounts' }, user.role === 'manager' ? h(React.Fragment, null,
            h('div', { className: 'mr-manager-account-head' }, h('span', null, `Назначено: ${user.account_ids.length}`), button(opening === user.user_id ? 'Загружаем…' : 'Назначить', () => openAccounts(user), { disabled: pending || opening !== null, 'aria-label': `Назначить аккаунты: ${user.username}` })),
            linked.length > 0 && h('div', { className: 'mr-manager-account-preview' }, linked.slice(0, 2).map(account => account.username ? '@' + account.username : account.phone_e164 || `#${account.id}`).join(' · '), linked.length > 2 ? ` · ещё ${linked.length - 2}` : '')) : h('span', { className: 'mr-caption' }, user.role === 'admin' ? 'Доступ ко всем' : '—')),
          h('td', { className: 'mr-manager-actions' },
            button('Изменить', () => setEditing(user), { disabled: pending }),
            user.role === 'voice' && h(VoiceBotLink, { userId: user.user_id, linked: user.telegram_linked }),
            button('Логин и пароль', () => showCredentials(user), { disabled: pending || opening !== null }),
            user.user_id !== me?.user_id && button('Удалить', () => remove(user), { disabled: pending, className: s.btnSmDanger })));
      }))),
    !loading && !visible.length && h('p', { className: s.empty }, 'Ничего не найдено. Измените поиск.'),
    editing && h(ManagerEditor, { key: editing.user_id, user: editing, me, availableRoles: data.roles, voicers: data.items.filter(u => u.role === 'voice'), onSave: save, onClose: () => setEditing(null) }),
    assigning && h(AccountAssignment, { key: assigning.user_id, user: assigning, users: data.items, accounts, onSave: save, onClose: () => setAssigning(null) }))));
}

export default ManagersPage;
