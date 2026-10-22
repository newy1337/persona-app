import React from 'react';
import { api } from '../api/client';
import Nav from '../components/Header/Header';
import s from '../styles/AdminPage.module.scss';
import { getAccounts as loadAccounts } from '../api/accounts';
import { PanelUX as ux } from './PanelUX';
import { VoiceBotLink } from '../pages/VoiceWork/VoiceBotLink';
import { PhotoCell, RegionStopButton, usePhotoAssignments } from '../pages/PhotoSets/StaffAssignments';
import { OwnRegionReassign } from './ReassignSwitch';
import { DEAL_STAGES, dealStageLabel } from '../data/dealStages';
import { LEAD_ROLE_FOR, ROLE_LABELS } from '../utils/roles';
import PickerModal from './PickerModal';
import { httpHref } from '../utils/safeUrl';

const h = React.createElement;
const { useState, useEffect, useCallback } = React;
const roles = ROLE_LABELS;
const validRegion = value => /^\d{3,4}$/.test(value);
const errorText = e => {
  const message = e.detail || e.message || 'Не удалось выполнить действие';
  return Array.isArray(message) ? message.join('; ') : String(message);
};
const button = (text, onClick, props = {}) => h('button', { type: 'button', className: s.btnSm, onClick, ...props }, text);

export function Attribution({ value, compact = false, as: Tag = 'div' }) {
  return h(Tag, { className: `mr-attribution ${compact ? 'mr-compact' : ''}`, 'data-testid': 'manager-attribution' },
    h('span', null, h('span', { className: 'mr-caption' }, 'Менеджер: '), value.manager_username || 'не назначен'),
    h('span', null, h('span', { className: 'mr-caption' }, 'Регион: '), value.region_code || 'не задан'));
}

export function DialogTable({ rows, totalRows, archived, sort, onSort, setSort, onOpen, onHide, onDealStage = null, helpers }) {
  const { Avatar, Stage, isNew, unreadLabel, presence, nextAction, time, date, accountLost, typingLabels } = helpers;
  const sortOptions = [
    ['', 'По умолчанию'], ['name:asc', 'Имя: А → Я'], ['name:desc', 'Имя: Я → А'],
    ['status:asc', 'Стадия: с начала'], ['status:desc', 'Стадия: с конца'],
    ['time:desc', 'Сначала новые'], ['time:asc', 'Сначала старые'],
  ];
  const heading = (label, col) => h('button', { type: 'button', className: 'mr-dialog-sort', onClick: () => onSort(col) },
    label, h('span', { 'aria-hidden': true }, sort.col === col ? sort.dir === 'asc' ? ' ↑' : ' ↓' : ' ↕'));
  const header = (label, col, width) => h('th', { scope: 'col', style: { width }, ...(col ? { 'aria-sort': sort.col === col ? sort.dir === 'asc' ? 'ascending' : 'descending' : 'none' } : {}) }, col ? heading(label, col) : label);
  const link = (username, label) => h('a', { href: `https://t.me/${username}`, target: '_blank', rel: 'noreferrer', onClick: e => e.stopPropagation() }, label || `@${username}`);
  return h('div', { className: 'mr-dialogs', 'data-testid': 'dialogs-list' },
    h('label', { className: 'mr-dialog-mobile-sort' }, 'Сортировка',
      h('select', { 'aria-label': 'Сортировка диалогов', value: sort.col ? `${sort.col}:${sort.dir}` : '', onChange: e => {
        const [col, dir] = e.target.value.split(':'); setSort({ col: col || null, dir: dir || 'asc' });
      } }, sortOptions.map(([value, label]) => h('option', { key: value, value }, label)))),
    h('table', { className: 'mr-dialog-table', 'aria-label': archived ? 'Архив диалогов' : 'Мои диалоги' },
      h('thead', null, h('tr', null, header('Собеседник', 'name', '27%'), header('Менеджер / регион', null, '22%'), header('Стадия и режим', 'status', '22%'), header('Последнее', 'time', '15%'), header('Действия', null, '14%'))),
      h('tbody', null, rows.map(row => {
        const fresh = isNew(row), online = presence(row.client_presence, undefined, { short: true });
        const next = nextAction(row.next_bot_action, undefined, { short: true });
        return h('tr', { key: row.chat_id, className: `mr-dialog-row ${fresh ? 'mr-dialog-new' : ''}`, 'data-chat-id': row.chat_id, onClick: () => onOpen(row.chat_id) },
          h('td', { className: 'mr-dialog-person' },
            h('div', { className: 'mr-dialog-person-head' },
              h(Avatar, { className: 'mr-dialog-avatar', style: { '--av-bg': '#234779' }, src: row.avatar_url, name: row.name || '—' }),
              h('div', { className: 'mr-dialog-person-text' },
                h('button', { type: 'button', className: 'mr-dialog-name', onClick: e => { e.stopPropagation(); onOpen(row.chat_id); } }, row.name || `Чат ${row.chat_id}`),
                fresh && h('span', { className: 'mr-dialog-new-badge', 'data-testid': 'new-badge', title: 'Клиент написал — ждёт ответа менеджера' }, unreadLabel(row.unread_count)),
                h('div', { className: 'mr-dialog-muted' }, row.typing ? `${typingLabels[row.typing] || 'печатает'}…` : [row.age ? `${row.age} лет` : null, row.city].filter(Boolean).join(' · ') || 'Возраст и город не указаны'))),
            h('div', { className: 'mr-dialog-contact' }, row.phone || null, row.client_username && link(row.client_username), !row.phone && !row.client_username && h('span', { className: 'mr-dialog-muted' }, 'Контакт не указан')),
            h('div', { className: 'mr-dialog-muted mr-dialog-id' }, `ID ${row.chat_id}`),
            row.blocked_by_client_at || row.cleared_by_client_at ? h('div', { className: 'mr-dialog-warning' }, row.blocked_by_client_at ? 'Заблокировал(а) нас' : 'Почистил(а) диалог') : online && h('div', { className: `mr-dialog-muted ${online.tone === 'online' ? 'mr-dialog-online' : ''}` }, online.text)),
          h('td', { className: 'mr-dialog-owner' }, h(Attribution, { value: row }),
            h('div', { className: 'mr-dialog-account' }, h('span', { className: 'mr-caption' }, 'Аккаунт: '), row.account_username ? link(row.account_username) : row.account_id ? `#${row.account_id}` : 'удалён'),
            row.account_lost && h('div', { className: 'mr-dialog-warning' }, accountLost(row.account_lost, { short: true }))),
          h('td', { className: 'mr-dialog-status', 'data-label': 'Стадия и режим' },
            h(Stage, { stage: row.stage }),
            row.hidden && !archived && h('div', { className: 'mr-dialog-archived', 'data-testid': 'archived-mark' }, 'в архиве'),
            onDealStage
              ? h('div', { className: `mr-dialog-deal ${row.deal_stage ? '' : 'mr-dialog-deal-missing'}`, 'data-testid': 'deal-stage', title: row.deal_note || undefined, onClick: e => e.stopPropagation() },
                  h('select', { className: 'mr-dialog-deal-select', 'aria-label': `Этап сделки: ${row.name || row.chat_id}`, value: row.deal_stage || '', onChange: e => { const stage = e.target.value; if (stage) onDealStage(row.chat_id, stage, row); } },
                    h('option', { value: '' }, row.deal_stage ? '— не задан' : 'Нужно указать этап'),
                    DEAL_STAGES.map(st => h('option', { key: st.id, value: st.id }, st.label))),
                  row.deal_stage === 'archive' && row.deal_note ? h('span', { className: 'mr-dialog-deal-note' }, row.deal_note) : null)
              : row.deal_stage && h('div', { className: 'mr-dialog-deal', 'data-testid': 'deal-stage', title: row.deal_note || undefined }, h('span', { className: 'mr-caption' }, 'Этап: '), dealStageLabel(row.deal_stage), row.deal_note ? ` · ${row.deal_note}` : ''),
            h('div', { className: `mr-dialog-mode ${row.is_paused ? 'mr-dialog-manual' : 'mr-dialog-online'}` }, row.is_paused ? fresh ? 'Менеджер · ждёт ответа' : 'Ведёт менеджер' : 'Ведёт бот'),
            next && h('div', { className: 'mr-dialog-muted', title: nextAction(row.next_bot_action)?.text }, next.text)),
          h('td', { className: 'mr-dialog-last', 'data-label': 'Последнее сообщение' }, h('span', { className: 'mr-dialog-time' }, time(row.last_message_ts)), h('span', { className: 'mr-dialog-muted' }, date(row.last_message_ts))),
          h('td', { className: 'mr-dialog-actions', onClick: e => e.stopPropagation() },
            h('button', { type: 'button', className: `${s.btnSm} mr-dialog-open`, onClick: () => onOpen(row.chat_id), 'aria-label': `Открыть диалог: ${row.name || row.chat_id}` }, 'Открыть', h('svg', { width: 14, height: 14, viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': true }, h('path', { d: 'M6 3.5 10.5 8 6 12.5', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round', strokeLinejoin: 'round' }))),
            onHide && h('button', { type: 'button', className: `${s.btnSm} mr-dialog-archive`, title: row.hidden ? 'Вернуть диалог из архива' : 'Убрать диалог с дашборда. Бот перестанет писать до нового сообщения клиента.', onClick: () => onHide(row.chat_id, !row.hidden) }, row.hidden ? 'Из архива' : 'В архив')));
      }), rows.length === 0 && h('tr', null, h('td', { className: 'mr-dialog-empty', colSpan: 5 }, totalRows === 0 ? archived ? 'В архиве пусто' : 'Диалогов нет' : 'Ничего не найдено — сбросьте поиск и фильтры')))));
}

export function CreateLeadForm({ personas, onDone, onCancel, PersonaSelect }) {
  const [draft, setDraft] = useState({ phone: '', first_name: '', city: '', age: '', site: '', first_message: '', persona_id: '', preferred_account_id: '', owner_user_id: '' });
  const [accounts, setAccounts] = useState([]);
  // Тимлид, хед и админ записывают лид на себя или на сотрудника команды; у менеджера выбора нет.
  const [owners, setOwners] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [reload, setReload] = useState(0);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let active = true;
    setLoading(true); setLoadError('');
    loadAccounts().then(rows => { if (active) setAccounts(rows); }).catch(e => { if (active) setLoadError(errorText(e)); }).finally(() => { if (active) setLoading(false); });
    api.get('/api/leads/owners').then(r => { if (active) setOwners(Array.isArray(r?.items) ? r.items : []); }).catch(() => { if (active) setOwners([]); });
    return () => { active = false; };
  }, [reload]);
  const owner = owners.find(o => String(o.user_id) === draft.owner_user_id && !o.self) || null;
  const change = patch => setDraft(previous => ({ ...previous, ...patch }));
  const valid = draft.phone.replace(/\D/g, '').length >= 10 || /^@?[a-zA-Z][\w]{3,}$|t\.me\//.test(draft.phone.trim());
  const available = accounts.filter(a => a.status === 'active' && personas.some(p => p.slug === a.persona_id) && (!draft.persona_id || a.persona_id === draft.persona_id) && (!owner || owner.account_ids.includes(a.id)));
  async function submit(e) {
    e.preventDefault();
    if (busy || !valid) return;
    setBusy(true); setError('');
    try {
      await api.post('/api/leads', { phone: draft.phone, first_name: draft.first_name || undefined, city: draft.city || undefined, age: draft.age ? Number(draft.age) : undefined, site: draft.site.trim() || undefined, first_message: draft.first_message.trim() || undefined, persona_id: draft.persona_id || undefined, preferred_account_id: draft.preferred_account_id ? Number(draft.preferred_account_id) : undefined, owner_user_id: owner ? owner.user_id : undefined });
      onDone();
    } catch (e) { setError(errorText(e)); }
    finally { setBusy(false); }
  }
  const input = (key, title, props = {}) => h('label', { className: s.label }, title, h('input', { className: s.field, value: draft[key], disabled: busy, onChange: e => change({ [key]: e.target.value }), ...props }));
  return h('form', { className: s.form, onSubmit: submit, 'aria-label': 'Добавление лида' },
    input('phone', 'Телефон или @username', { autoFocus: true, placeholder: '+7 900 123-45-67 или @name', maxLength: 64 }),
    owners.length > 1 && h('label', { className: s.label }, 'Чей лид',
      h('select', { className: s.select, value: draft.owner_user_id, disabled: busy, 'aria-label': 'Чей лид', onChange: e => change({ owner_user_id: e.target.value, preferred_account_id: '' }) },
        owners.map(o => h('option', { key: o.user_id, value: o.self ? '' : String(o.user_id) }, o.self ? `Себе (${o.username})` : [o.username, ROLE_LABELS[o.role] || o.role, o.region_code ? `регион ${o.region_code}` : null].filter(Boolean).join(' · '))))),
    input('first_name', 'Имя', { maxLength: 64 }), input('city', 'Город', { maxLength: 64 }),
    input('age', 'Возраст', { inputMode: 'numeric' }), input('site', 'Сайт знакомств', { placeholder: 'beboo', maxLength: 64 }),
    h('label', { className: s.label }, 'С какой личности писать', draft.preferred_account_id ? h('select', { className: s.select, disabled: true, value: draft.persona_id, title: 'Личность выбранного аккаунта' }, h('option', { value: draft.persona_id }, personas.find(p => p.slug === draft.persona_id)?.name || draft.persona_id)) : h(PersonaSelect, { personas, value: draft.persona_id, onChange: value => change({ persona_id: value }) })),
    h('div', { className: `${s.formFull} mr-lead-sender` },
      h('label', { className: s.label }, 'Telegram-аккаунт для первого сообщения',
        h('select', { className: s.select, value: draft.preferred_account_id, disabled: busy || loading, onChange: e => {
          const chosen = accounts.find(a => a.id === Number(e.target.value));
          change({ preferred_account_id: e.target.value, ...(chosen ? { persona_id: chosen.persona_id } : {}) });
        } }, h('option', { value: '' }, loading ? 'Загружаем аккаунты…' : 'Автоматически'), available.map(a => h('option', { key: a.id, value: String(a.id) }, [a.username ? `@${a.username}` : a.first_name || a.phone_e164 || `Аккаунт #${a.id}`, a.username ? a.phone_e164 : null, personas.find(p => p.slug === a.persona_id)?.name].filter(Boolean).join(' · '))))),
      h('p', { className: 'mr-caption' }, draft.preferred_account_id ? 'Напишет только выбранный аккаунт. Если он временно недоступен, лид останется в очереди.' : 'Без выбора аккаунт подбирается автоматически, как раньше.'),
      !loading && !loadError && available.length === 0 && h('p', { className: 'mr-caption' }, owner ? `У ${owner.username} нет включённых аккаунтов${draft.persona_id ? ' этой личности' : ''} — лид будет ждать в очереди.` : 'Нет включённых аккаунтов для этой личности.'),
      loadError && h('div', { role: 'alert' }, h('p', { className: s.error }, `Не удалось загрузить аккаунты: ${loadError}`), button('Повторить', () => setReload(n => n + 1)))),
    h('div', { className: s.formFull },
      h('label', { className: s.label }, 'Первое сообщение',
        h('textarea', { className: s.field, rows: 3, maxLength: 1000, value: draft.first_message, disabled: busy, placeholder: 'Оставьте пустым — бот напишет по шаблону личности', style: { resize: 'vertical' }, onChange: e => change({ first_message: e.target.value }) })),
      h('p', { className: 'mr-caption' }, draft.first_message.trim() ? 'Лид получит именно этот текст, без подстановок. Дальше диалог ведёт бот.' : 'Без текста первое сообщение составит бот, как раньше.')),
    error && h('p', { className: `${s.error} ${s.formFull}`, role: 'alert' }, error),
    h('div', { className: `${s.formFull} ${s.actions}` }, button('Отмена', onCancel, { className: s.btn, disabled: busy }), h('button', { type: 'submit', className: s.btnPrimary, disabled: busy || !valid }, busy ? 'Добавляем…' : 'Добавить')));
}

export function LeadsTable({ ready = true, rows, query, status, selected, onToggle, onSelectVisible, onClearSelection, onChat, onQueue, onUnqueue, onReassign, onDelete, onPersonaChange, personas, helpers }) {
  const { PersonaSelect, statusLabels, statusClasses, date, dealStage = null } = helpers;
  const busy = ux.useActions().pending.some(key => key.includes('/api/leads'));
  const allSelected = rows.length > 0 && rows.every(row => selected.has(row.id));
  const someSelected = rows.some(row => selected.has(row.id));
  const telegramLink = username => h('a', { href: `https://t.me/${username}`, target: '_blank', rel: 'noreferrer' }, `@${username}`);
  const action = (text, onClick, className = 'mr-lead-action', props = {}) => h('button', { type: 'button', className: `${className === 'mr-lead-delete' ? s.btnSmDanger : s.btnSm} ${className}`, onClick, disabled: busy, ...props }, text);
  return h('div', { className: 'mr-dialogs mr-leads-list', 'data-testid': 'leads-list' },
    (rows.length > 0 || selected.size > 0) && h('div', { className: 'mr-lead-selection' },
      h('label', { className: 'mr-lead-select-all' }, h('input', { type: 'checkbox', checked: allSelected, disabled: rows.length === 0, ref: input => { if (input) input.indeterminate = someSelected && !allSelected; }, onChange: e => onSelectVisible(e.target.checked) }), 'Выбрать показанные'),
      h('span', { className: 'mr-dialog-muted', role: 'status' }, selected.size ? `Выбрано: ${selected.size}` : `Показано: ${rows.length}`),
      selected.size > 0 && action('Снять выделение', onClearSelection, 'mr-lead-clear')),
    rows.length === 0 ? h('div', { className: 'mr-lead-empty' }, !ready ? 'Загружаем лидов…' : query || status ? 'По этим условиям лидов нет. Измените поиск или фильтр.' : 'Лидов пока нет. Добавьте контакт или импортируйте список.') :
      h('table', { className: 'mr-dialog-table mr-leads-table', 'aria-label': 'Лиды' },
        h('thead', null, h('tr', null, ['Лид и контакт', 'Менеджер / регион', 'Личность', 'Статус', 'Действия'].map((title, i) => h('th', { key: title, scope: 'col', style: { width: ['27%', '22%', '18%', '19%', '14%'][i] } }, title)))),
        h('tbody', null, rows.map(row => {
          const name = row.first_name || row.phone_e164 || (row.username ? `@${row.username}` : `Лид #${row.id}`);
          const canChat = row.telegram_user_id && ['contacted', 'replied', 'assigned'].includes(row.status);
          const senderId = row.assigned_account_id || row.preferred_account_id;
          const senderUsername = row.assigned_account_id ? row.assigned_account_username : row.preferred_account_username;
          return h('tr', { key: row.id, className: `mr-lead-row ${selected.has(row.id) ? 'mr-lead-selected' : ''}`, 'data-lead-id': row.id, 'data-lead-status': row.status },
            h('td', { className: 'mr-lead-person' },
              h('label', { className: 'mr-lead-identity' }, h('input', { type: 'checkbox', checked: selected.has(row.id), 'aria-label': `Выбрать лид: ${name}`, onChange: () => onToggle(row.id) }), h('span', { className: 'mr-lead-name' }, name)),
              h('div', { className: 'mr-dialog-muted' }, [row.age ? `${row.age} лет` : null, row.city].filter(Boolean).join(' · ') || 'Возраст и город не указаны'),
              h('div', { className: 'mr-dialog-contact' }, row.phone_e164 || null, row.username && telegramLink(row.username)),
              h('div', { className: 'mr-dialog-muted' }, `#${row.id}`, row.site ? ` · Сайт: ${row.site}` : ''),
              row.first_message && h('div', { className: 'mr-dialog-muted', title: row.first_message }, h('span', { className: 'mr-caption' }, row.first_contact_at ? 'Первое сообщение: ' : 'Напишем: '), row.first_message.length > 80 ? `${row.first_message.slice(0, 80)}…` : row.first_message),
              (row.telegram_username || row.telegram_user_id) && h('div', { className: 'mr-lead-telegram' }, h('span', { className: 'mr-caption' }, 'Telegram: '), row.telegram_username ? telegramLink(row.telegram_username) : String(row.telegram_user_id)),
              (row.donor || row.inbound_at || row.account_label || row.external_id) && h('div', { className: 'mr-dialog-muted mr-lead-inbound', 'data-testid': 'lead-inbound' },
                [row.inbound_at ? `Источник: ${row.source_type}` : null, row.requested_region ? `Регион: ${row.requested_region}` : null, row.requested_persona ? `Личность: ${row.requested_persona}` : null, row.reassigned ? 'Перезабив' : null, row.cold ? 'Холодка' : null, row.donor ? `Донор: ${row.donor}` : null, row.account_label ? `Аккаунт: ${row.account_label}` : null, row.external_id ? `ID: ${row.external_id}` : null].filter(Boolean).join(' · ')),
              row.profile_url && h('div', { className: 'mr-dialog-muted' }, h('span', { className: 'mr-caption' }, 'Профиль: '), httpHref(row.profile_url) ? h('a', { href: httpHref(row.profile_url), target: '_blank', rel: 'noreferrer' }, row.profile_url.replace(/^https?:\/\//i, '').slice(0, 60)) : h('span', { 'data-testid': 'profile-text' }, String(row.profile_url).slice(0, 60))),
              row.last_messages && h('details', { className: 'mr-lead-error mr-lead-history' }, h('summary', null, 'История общения от донора'), h('p', null, row.last_messages))),
            h('td', { className: 'mr-lead-owner' }, h(Attribution, { value: row }),
              h('div', { className: 'mr-dialog-account' }, h('span', { className: 'mr-caption' }, row.preferred_account_id && !row.first_contact_at ? 'Выбран: ' : 'Аккаунт: '), senderId ? h(React.Fragment, null, senderUsername && telegramLink(senderUsername), ` #${senderId}`) : 'автоматически')),
            h('td', { className: 'mr-lead-persona', 'data-label': 'Личность' }, row.first_contact_at || row.preferred_account_id ? h('span', { className: 'mr-lead-persona-name', title: row.preferred_account_id ? 'Личность выбранного аккаунта' : undefined }, row.persona_name || row.persona_id || 'Не указана') :
              h('label', { className: 'mr-lead-persona-field' }, h('span', { className: 'mr-sr-only' }, `Личность лида: ${name}`), h(PersonaSelect, { personas, value: row.persona_id, className: `${s.select} mr-lead-persona-select`, onChange: persona => onPersonaChange(row.id, persona) }))),
            h('td', { className: 'mr-lead-status', 'data-label': 'Статус' },
              h('span', { className: statusClasses[row.status] || s.badge }, statusLabels[row.status] || row.status),
              h('div', { className: 'mr-lead-contact-time mr-dialog-muted' }, row.first_contact_at ? `Написали: ${date(row.first_contact_at)}` : 'Ещё не писали'),
              row.deal_stage && h('div', { className: 'mr-dialog-muted', 'data-testid': 'lead-deal-stage' }, h('span', { className: 'mr-caption' }, 'Этап: '), dealStage ? dealStage(row.deal_stage) : row.deal_stage),
              row.last_error && h('details', { className: 'mr-lead-error' }, h('summary', null, 'Подробнее об ошибке'), h('p', null, row.last_error))),
            h('td', { className: 'mr-dialog-actions mr-lead-actions' },
              canChat && h('button', { type: 'button', className: `${s.btnSm} mr-dialog-open`, 'aria-label': `Открыть диалог: ${name}`, onClick: () => onChat(row.telegram_user_id) }, 'Открыть', h('svg', { width: 14, height: 14, viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': true }, h('path', { d: 'M6 3.5 10.5 8 6 12.5', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round', strokeLinejoin: 'round' }))),
              ['pending', 'dead'].includes(row.status) && action(row.status === 'dead' ? 'Ещё раз' : 'В очередь', () => onQueue([row.id])),
              row.status === 'queued' && action('Снять', () => onUnqueue([row.id])),
              !row.first_contact_at && senderId && ['pending', 'queued', 'assigned', 'dead'].includes(row.status) && action('Написать с другого', () => onReassign(row), 'mr-lead-action', { title: `Отдать лид другому аккаунту — ${senderUsername ? `@${senderUsername}` : `#${senderId}`} его больше не возьмёт` }),
              action('Удалить', () => onDelete(row), 'mr-lead-delete')));
        }))));
}

export function AccountsTable({ rows, alive, onEdit, onLogin, onProxy, onStatus, onClearFlood, onDelete, helpers, selection, onPhotoAutoSend }) {
  const pending = ux.useActions().pending;
  const [expanded, setExpanded] = useState(null);
  const { Avatar, statusLabel, statusClasses, date } = helpers;
  const chevron = open => h('svg', { width: 12, height: 12, viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': true, style: { transform: open ? 'rotate(180deg)' : undefined } }, h('path', { d: 'm4 6 4 4 4-4', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round', strokeLinejoin: 'round' }));
  if (!rows.length) return h('p', { className: s.empty }, 'Аккаунтов нет. Добавьте номер, затем войдите — код придёт в Telegram.');
  return h('table', { className: 'mr-account-table', 'aria-label': 'Telegram-аккаунты' },
    h('thead', null, h('tr', null, ['Аккаунт', 'Личность / менеджер', 'Состояние', 'Действия'].map((label, index) => h('th', { key: label, scope: 'col', style: { width: ['30%', '28%', '17%', '25%'][index] } },
      index === 0 && selection && h('input', { type: 'checkbox', className: 'mr-account-select', 'aria-label': 'Выбрать все аккаунты', checked: rows.length > 0 && rows.every(r => selection.selected.has(r.id)), onChange: () => selection.toggleAll(rows.map(r => r.id)) }),
      label)))),
    h('tbody', null, rows.map(row => {
      const busy = pending.some(key => key.split(':').slice(1).join(':') === `/api/tg-accounts/${row.id}` || key.includes(`/api/tg-accounts/${row.id}/`));
      const accountButton = (text, onClick, props = {}) => button(text, onClick, { disabled: busy, ...props });
      const name = row.display_name || (row.username ? `@${row.username}` : row.phone_e164 || `Аккаунт #${row.id}`);
      const online = alive[row.id] ?? row.online;
      const open = expanded === row.id;
      const loginNeeded = row.status === 'unauthorized' || row.status === 'banned';
      const detailsId = `account-details-${row.id}`;
      const facts = [
        ['ID аккаунта', `#${row.id}`], ['Диалогов', row.chats ?? 0],
        ['Прокси', row.needs_proxy_setup ? 'Не задан' : row.proxy_label || row.proxy_geo || 'Задан'],
        ['Назначение', row.purpose === 'test' ? 'Тестовый' : row.purpose === 'prod' ? 'Рабочий' : row.purpose || '—'],
        ['Последний вход', date(row.last_login_at)], ['Пульс', date(row.last_heartbeat_at)],
        ['Лимит сообщений в день', row.daily_msg_quota ?? 'Без лимита'],
        ['Образ', row.photo_set_name || 'Не назначен'],
        ['Автоотправка фото', row.photo_auto_send ? 'Разрешена' : 'Выключена для аккаунта'],
      ];
      return h(React.Fragment, { key: row.id },
        h('tr', { className: `mr-account-row ${open ? 'mr-account-expanded' : ''}`, 'data-account-id': row.id },
          h('td', { className: 'mr-account-identity' },
            h('div', { className: 'mr-account-who' },
              selection && h('input', { type: 'checkbox', className: 'mr-account-select', 'aria-label': `Выбрать ${name}`, checked: selection.selected.has(row.id), onChange: () => selection.toggle(row.id) }),
              h(Avatar, { className: 'mr-account-avatar', style: { '--av-bg': '#49375f' }, src: row.avatar_url, name }),
              h('div', { className: 'mr-account-name-wrap' },
                h('div', { className: 'mr-account-name' }, name),
                h('div', { className: 'mr-account-contact' },
                  row.username && row.display_name && h('a', { href: `https://t.me/${row.username}`, target: '_blank', rel: 'noreferrer' }, `@${row.username}`),
                  row.username && !row.display_name && h('a', { href: `https://t.me/${row.username}`, target: '_blank', rel: 'noreferrer', 'aria-label': `Профиль ${row.username}` }, 'Telegram'),
                  row.phone_e164 && row.phone_e164 !== name && h('span', null, row.phone_e164))))),
          h('td', { className: 'mr-account-assignment' },
            h('div', { className: 'mr-account-persona' }, row.persona_name || row.persona_id || 'Без личности', row.purpose === 'test' && h('span', { className: 'mr-account-test' }, 'Тест')),
            h('div', { className: 'mr-account-owner', 'data-testid': 'account-owner' },
              h('span', { title: row.manager_username ? `Менеджер: ${row.manager_username}` : undefined }, row.manager_username || 'Без менеджера'),
              h('span', { className: 'mr-account-region' }, row.region_code ? `Регион ${row.region_code}` : 'Регион не задан')),
            h('div', { className: 'mr-account-owner', 'data-testid': 'account-photo-set' },
              h('span', null, row.photo_set_name ? `Образ: ${row.photo_set_name}` : 'Без образа'),
              row.photo_set_id && !row.photo_auto_send && h('span', { className: 'mr-account-region' }, 'автоотправка фото выкл.'))),
          h('td', { className: 'mr-account-state' },
            h('span', { className: row.status === 'unauthorized' && row.lost_at ? s.badgeBanned : statusClasses[row.status] || s.badge, title: row.lost_reason || undefined }, statusLabel(row)),
            h('span', { className: `mr-account-connection ${online ? 'mr-account-online' : ''}` }, h('i', { 'aria-hidden': true }), online ? 'В сети' : 'Не в сети'),
            row.flood_until && h('span', { className: 'mr-account-warning', title: `Ограничение Telegram до ${date(row.flood_until)}` }, 'Ограничен')),
          h('td', { className: 'mr-account-actions' }, h('div', { className: 'mr-account-buttons' },
            accountButton('Изменить', () => onEdit(row)),
            loginNeeded ? accountButton('Войти', () => onLogin(row)) : row.status === 'active' ? accountButton('Пауза', () => onStatus(row, 'paused')) : row.status === 'paused' ? accountButton('Включить', () => onStatus(row, 'active')) : null,
            accountButton(h(React.Fragment, null, 'Ещё', chevron(open)), () => setExpanded(open ? null : row.id), { className: `${s.btnSm} mr-account-more`, 'aria-expanded': open, 'aria-controls': detailsId, 'aria-label': `Ещё: ${name}` })))),
        open && h('tr', { className: 'mr-account-details-row' }, h('td', { colSpan: 4 },
          h('div', { id: detailsId, className: 'mr-account-details', role: 'region', 'aria-label': `Подробности: ${name}` },
            h('dl', null, facts.map(([label, value]) => h('div', { key: label }, h('dt', null, label), h('dd', null, value)))),
            row.lost_at && h('p', { className: 'mr-account-warning' }, `${row.lost_reason || 'Аккаунт потерян'} · ${date(row.lost_at)}`),
            row.flood_until && h('p', { className: 'mr-account-warning' }, `${row.flood_reason || 'Ограничение Telegram'} · до ${date(row.flood_until)}`),
            h('div', { className: 'mr-account-extra-actions' },
              accountButton('Прокси', () => onProxy(row)),
              onPhotoAutoSend && accountButton(row.photo_auto_send ? 'Выключить автофото' : 'Включить автофото', () => onPhotoAutoSend(row, !row.photo_auto_send)),
              !loginNeeded && row.status !== 'retired' && accountButton('Перелогин', () => onLogin(row)),
              row.flood_until && accountButton('Снять флуд', () => onClearFlood(row), { title: 'Аккаунт снова будет брать новых лидов' }),
              row.status !== 'retired' && row.status !== 'banned' && accountButton('Вывести', () => onStatus(row, 'retired')),
              accountButton('Удалить', () => onDelete(row), { className: s.btnSmDanger }))))));
    })));
}

/** Сколько человек в подчинении по цепочке руководителей. */
export function teamSize(user, users) {
  const seen = new Set([user.user_id]);
  let frontier = [user.user_id];
  while (frontier.length) {
    frontier = users.filter(u => frontier.includes(u.lead_id) && !seen.has(u.user_id)).map(u => u.user_id);
    for (const id of frontier) seen.add(id);
  }
  return seen.size - 1;
}

function LeadSelect({ role, region, users, value, onChange, disabled, selfId = null }) {
  const wanted = LEAD_ROLE_FOR[role];
  if (!wanted) return null;
  const sameRegion = users.filter(u => u.role === wanted && u.user_id !== selfId && (!region || u.region_code === region));
  if (role === 'teamlead') {
    const head = sameRegion[0];
    return h('p', { className: 'mr-caption', 'data-testid': 'auto-head' }, region
      ? head ? `Хед региона ${region}: ${head.username} — назначается автоматически.` : `В регионе ${region} пока нет хеда: тимлид привяжется к нему, как только хед появится.`
      : 'Укажите регион — хед региона назначится автоматически.');
  }
  const head = users.find(u => u.role === 'head' && region && u.region_code === region);
  return h('label', { className: s.label }, 'Тимлид', h('select', { className: s.select, value, disabled: disabled || !region, 'aria-label': 'Руководитель', onChange: e => onChange(e.target.value) },
    h('option', { value: '' }, head ? `Без тимлида — напрямую хеду ${head.username}` : 'Не назначен'), sameRegion.map(u => h('option', { key: u.user_id, value: u.user_id }, u.username))),
    h('span', { className: 'mr-caption' }, region ? (sameRegion.length ? 'Тимлид видит диалоги и лидов своих менеджеров.' : `В регионе ${region} пока нет тимлидов${head ? ', менеджеры подчиняются хеду напрямую' : ''}.`) : 'Сначала укажите регион.'));
}

function VoicerSelect({ voicers, value, onChange, disabled }) {
  return h('label', { className: s.label }, 'Войсер', h('select', { className: s.select, value, disabled, onChange: e => onChange(e.target.value) },
    h('option', { value: '' }, 'Не назначен'), voicers.map(v => h('option', { key: v.user_id, value: v.user_id }, `${v.username}${v.telegram_linked ? '' : ' · Telegram не подключён'}`))), h('span', { className: 'mr-caption' }, 'Назначение применяется к новым заданиям.'));
}

function CreateForm({ availableRoles, voicers, users = [], donors = [], onCreate, onCancel }) {
  const [username, setUsername] = useState('');
  const [role, setRole] = useState('manager');
  const [donorIds, setDonorIds] = useState(() => new Set());
  const [pickingDonors, setPickingDonors] = useState(false);
  const [region, setRegion] = useState('');
  const [voicer, setVoicer] = useState('');
  const [lead, setLead] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const needsRegion = ['manager', 'teamlead', 'head'].includes(role);
  const valid = Boolean(username.trim()) && (!needsRegion || validRegion(region));
  async function submit(e) {
    e.preventDefault();
    if (!valid || busy) return;
    setBusy(true); setError('');
    try { await onCreate({ username: username.trim(), role, ...(region ? { region_code: region } : {}), ...(role === 'manager' ? { voicer_id: voicer ? Number(voicer) : null } : {}), ...(LEAD_ROLE_FOR[role] ? { lead_id: lead ? Number(lead) : null } : {}), ...(role === 'manager' && donorIds.size ? { donor_ids: [...donorIds] } : {}) }); }
    catch (e) { setError(errorText(e)); }
    finally { setBusy(false); }
  }
  return h('form', { onSubmit: submit, className: 'mr-create', 'aria-label': 'Создание учётки' },
    h('label', { className: s.label }, 'Логин', h('input', { className: s.field, value: username, autoFocus: true, required: true, maxLength: 64, autoComplete: 'off', onChange: e => setUsername(e.target.value) })),
    h('label', { className: s.label }, 'Роль', h('select', { className: s.select, value: role, onChange: e => setRole(e.target.value) }, availableRoles.map(r => h('option', { key: r, value: r }, roles[r] || r)))),
    h('label', { className: s.label }, 'Регион (3–4 цифры)', h('input', { className: s.field, type: 'text', inputMode: 'numeric', pattern: '[0-9]{3,4}', maxLength: 4, required: needsRegion, placeholder: 'Например, 077', value: region, onChange: e => setRegion(e.target.value.replace(/\D/g, '').slice(0, 4)) })),
    role === 'manager' && h(VoicerSelect, { voicers, value: voicer, onChange: setVoicer }),
    h(LeadSelect, { role, region, users, value: lead, onChange: setLead }),
    role === 'manager' && donors.length > 0 && h('div', { className: s.label, 'data-testid': 'create-donors' }, 'Доноры',
      h('button', { type: 'button', className: s.btnSm, onClick: () => setPickingDonors(true) }, donorIds.size ? `Выбрано: ${donorIds.size}` : 'Любые — выбрать'),
      h('span', { className: 'mr-caption' }, 'Чьих лидов принимает по API. Онлайн, лимит и источники — на странице LeadGet.')),
    pickingDonors && h(PickerModal, { title: 'Доноры нового менеджера', items: donors, value: donorIds, onSave: async ids => setDonorIds(new Set(ids)), onClose: () => setPickingDonors(false), anyHint: 'Ничего не выбрано — принимает лидов любых доноров.' }),
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

function ManagerEditor({ user, me, availableRoles, voicers, users = [], onSave, onClose, leadOnly = false }) {
  const [role, setRole] = useState(user.role), [region, setRegion] = useState(user.region_code || '');
  const [username, setUsername] = useState(user.username);
  const canRename = !leadOnly && me?.role === 'admin';
  const usernameChanged = canRename && username.trim() !== user.username;
  const [voicer, setVoicer] = useState(String(user.voicer_id || ''));
  const [lead, setLead] = useState(String(user.lead_id || ''));
  const [photoEdit, setPhotoEdit] = useState(Boolean(user.can_edit_photo_sets));
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const lock = React.useRef(false);
  const changed = usernameChanged || role !== user.role || region !== (user.region_code || '') || voicer !== String(user.voicer_id || '') || lead !== String(user.lead_id || '') || photoEdit !== Boolean(user.can_edit_photo_sets);
  const usernameValid = !canRename || username.trim().length > 0;
  const valid = usernameValid && (region === '' ? !['manager', 'teamlead', 'head'].includes(role) || user.role === role && !user.region_code : validRegion(region));
  async function save(event) {
    event.preventDefault();
    if (lock.current || !changed || !valid) return;
    lock.current = true;
    if (user.role === 'manager' && role !== 'manager' && user.account_ids.length && !await ux.confirm({ title: 'Изменить роль?', message: `У ${user.username} будут освобождены аккаунты: ${user.account_ids.length}.`, confirmLabel: 'Изменить роль' })) { lock.current = false; return; }
    setBusy(true); setError('');
    try {
      await onSave(user.user_id, leadOnly ? { lead_id: lead ? Number(lead) : null } : { ...(usernameChanged ? { username: username.trim() } : {}), role, region_code: region || null, voicer_id: role === 'manager' && voicer ? Number(voicer) : null, lead_id: LEAD_ROLE_FOR[role] && lead ? Number(lead) : null, ...(photoEdit !== Boolean(user.can_edit_photo_sets) ? { can_edit_photo_sets: photoEdit } : {}), ...(user.role === 'manager' && role !== 'manager' ? { account_ids: [] } : {}) });
      onClose();
    } catch (e) { setError(ux.readableError(e)); }
    finally { lock.current = false; setBusy(false); }
  }
  return h(ux.Modal, { title: `Учётка: ${user.username}`, onClose, busy, footer: h(React.Fragment, null,
    button('Отмена', onClose, { disabled: busy }),
    h('button', { type: 'submit', form: 'manager-editor', className: s.btnPrimary, disabled: !changed || !valid || busy }, busy ? 'Сохраняем…' : 'Сохранить')) },
    h('form', { id: 'manager-editor', className: 'mr-manager-form', onSubmit: save },
      canRename && h('label', { className: s.label }, 'Логин', h('input', { className: s.field, value: username, disabled: busy, maxLength: 64, autoComplete: 'off', 'aria-label': 'Логин', onChange: e => setUsername(e.target.value) }),
        h('span', { className: 'mr-caption' }, 'Под этим именем входят в панель. Пароль не меняется.')),
      h('label', { className: s.label }, 'Роль', h('select', { className: s.select, value: role, disabled: busy || leadOnly || user.user_id === me?.user_id, onChange: e => setRole(e.target.value) }, availableRoles.map(r => h('option', { key: r, value: r }, roles[r] || r)))),
      h('label', { className: s.label }, 'Регион (3–4 цифры)', h('input', { className: s.field, 'data-autofocus': !leadOnly, value: region, disabled: busy || leadOnly, inputMode: 'numeric', maxLength: 4, placeholder: 'Например, 0077', onChange: e => setRegion(e.target.value.replace(/\D/g, '').slice(0, 4)) })),
      role === 'manager' && !leadOnly && h(VoicerSelect, { voicers, value: voicer, onChange: setVoicer, disabled: busy }),
      h(LeadSelect, { role, region, users, value: lead, onChange: setLead, disabled: busy, selfId: user.user_id }),
      !leadOnly && role !== 'admin' && role !== 'voice' && h('label', { className: `${s.check} mr-check-row` },
        h('input', { type: 'checkbox', checked: photoEdit, disabled: busy, onChange: e => setPhotoEdit(e.target.checked) }),
        'Может менять образы'),
      !usernameValid && h('p', { className: 'ux-inline-error' }, 'Логин не может быть пустым.'),
      usernameValid && !valid && h('p', { className: 'ux-inline-error' }, 'Укажите код региона: 3 или 4 цифры.'),
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
  const [donors, setDonors] = useState([]);
  const reload = useCallback(async () => {
    const [users, accountRows, currentUser] = await Promise.all([api.get('/api/managers'), loadAccounts(), api.get('/auth/me')]);
    setData(users); setAccounts(accountRows); setMe(currentUser);
    if (currentUser?.role === 'admin') api.get('/api/donors').then(d => setDonors(Array.isArray(d?.items) ? d.items : [])).catch(() => setDonors([]));
    return { users, accountRows };
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
  const admin = me?.role === 'admin';
  const photo = usePhotoAssignments(data.items.map(user => user.region_code));
  return h('div', { className: 'app mr-managers' }, h(Nav), h('main', { className: 'main' }, h('div', { className: 'container' },
    h('div', { className: s.head }, h('h2', { className: s.title }, admin ? 'Менеджеры' : `Моя команда · регион ${me?.region_code || ''}`), h('div', { className: s.actions }, !admin && h(OwnRegionReassign), !admin && h(RegionStopButton), admin && !creating && button('+ Создать учётку', () => { setCreating(true); setCredentials(null); }, { className: s.btnPrimary }))),
    creating && h(CreateForm, { availableRoles: data.roles, voicers: data.items.filter(u => u.role === 'voice'), users: data.items, donors, onCreate: create, onCancel: () => setCreating(false) }),
    (error || photo.error) && h('p', { className: s.error, role: 'alert' }, error || photo.error),
    credentials && h(Credentials, { value: credentials, onClose: () => setCredentials(null), onRegenerate: regenerate }),
    h('div', { className: 'mr-manager-toolbar' }, h('input', { className: s.field, type: 'search', 'aria-label': 'Поиск менеджеров', placeholder: 'Логин, регион или роль', value: query, onChange: e => setQuery(e.target.value) }), h('span', { className: 'mr-caption' }, loading ? 'Загружаем…' : `Показано: ${visible.length}`)),
    h('table', { className: 'mr-manager-table', 'aria-label': 'Менеджеры' },
      h('thead', null, h('tr', null, ['Учётка', 'Роль / регион', 'Аккаунты', 'Образ', 'Действия'].map((title, index) => h('th', { key: title, scope: 'col', style: { width: ['18%', '14%', '20%', '26%', '22%'][index] } }, title)))),
      h('tbody', null, visible.map(user => {
        const linked = accounts.filter(account => user.account_ids.includes(account.id));
        return h('tr', { key: user.user_id, 'data-manager-id': user.user_id },
          h('td', { className: 'mr-manager-identity' }, h('strong', null, user.username), user.user_id === me?.user_id && h('span', { className: 'mr-caption' }, 'Это вы'), user.role === 'manager' && h('span', { className: 'mr-caption' }, `Войсер: ${user.voicer_username || 'не назначен'}`), LEAD_ROLE_FOR[user.role] && h('span', { className: 'mr-caption' }, `Руководитель: ${user.lead_username || 'не назначен'}`), user.role === 'voice' && h('span', { className: 'mr-caption' }, user.telegram_linked ? 'Telegram подключён' : 'Telegram не подключён')),
          h('td', { className: 'mr-manager-role' }, h('span', null, roles[user.role] || user.role), h('span', { className: 'mr-caption' }, user.region_code ? `Регион ${user.region_code}` : 'Регион не задан')),
          h('td', { className: 'mr-manager-accounts' }, user.role === 'manager' ? h(React.Fragment, null,
            h('div', { className: 'mr-manager-account-head' }, h('span', null, `Назначено: ${user.account_ids.length}`), admin && button(opening === user.user_id ? 'Загружаем…' : 'Назначить', () => openAccounts(user), { disabled: pending || opening !== null, 'aria-label': `Назначить аккаунты: ${user.username}` })),
            linked.length > 0 && h('div', { className: 'mr-manager-account-preview' }, linked.slice(0, 2).map(account => account.username ? '@' + account.username : account.phone_e164 || `#${account.id}`).join(' · '), linked.length > 2 ? ` · ещё ${linked.length - 2}` : '')) : h('span', { className: 'mr-caption' }, user.role === 'admin' ? 'Доступ ко всем' : user.role === 'teamlead' || user.role === 'head' ? `Команда: ${teamSize(user, data.items)} чел.` : '—')),
          h('td', { className: 'mr-manager-photo' }, h(PhotoCell, { user, photo })),
          h('td', { className: 'mr-manager-actions' },
            (admin || user.role === 'manager') && button(admin ? 'Изменить' : 'Назначить тимлида', () => setEditing(user), { disabled: pending }),
            admin && user.role === 'voice' && h(VoiceBotLink, { userId: user.user_id, linked: user.telegram_linked }),
            admin && button('Логин и пароль', () => showCredentials(user), { disabled: pending || opening !== null }),
            admin && user.user_id !== me?.user_id && button('Удалить', () => remove(user), { disabled: pending, className: s.btnSmDanger })));
      }))),
    !loading && !visible.length && h('p', { className: s.empty }, 'Ничего не найдено. Измените поиск.'),
    editing && h(ManagerEditor, { key: editing.user_id, user: editing, me, availableRoles: data.roles, voicers: data.items.filter(u => u.role === 'voice'), users: data.items, leadOnly: !admin, onSave: save, onClose: () => setEditing(null) }),
    assigning && h(AccountAssignment, { key: assigning.user_id, user: assigning, users: data.items, accounts, onSave: save, onClose: () => setAssigning(null) }))));
}
