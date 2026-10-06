import React from 'react';
import s from '../../styles/AdminPage.module.scss';
import { PanelUX as ux } from '../../ui/PanelUX';
import { Attribution } from '../../components/Attribution/Attribution';

const h = React.createElement;

export function LeadsTable({ ready = true, rows, query, status, selected, onToggle, onSelectVisible, onClearSelection, onChat, onQueue, onUnqueue, onReassign, onDelete, onPersonaChange, personas, helpers }) {
  const { PersonaSelect, statusLabels, statusClasses, date } = helpers;
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
              (row.telegram_username || row.telegram_user_id) && h('div', { className: 'mr-lead-telegram' }, h('span', { className: 'mr-caption' }, 'Telegram: '), row.telegram_username ? telegramLink(row.telegram_username) : String(row.telegram_user_id))),
            h('td', { className: 'mr-lead-owner' }, h(Attribution, { value: row }),
              h('div', { className: 'mr-dialog-account' }, h('span', { className: 'mr-caption' }, row.preferred_account_id && !row.first_contact_at ? 'Выбран: ' : 'Аккаунт: '), senderId ? h(React.Fragment, null, senderUsername && telegramLink(senderUsername), ` #${senderId}`) : 'автоматически')),
            h('td', { className: 'mr-lead-persona', 'data-label': 'Личность' }, row.first_contact_at || row.preferred_account_id ? h('span', { className: 'mr-lead-persona-name', title: row.preferred_account_id ? 'Личность выбранного аккаунта' : undefined }, row.persona_name || row.persona_id || 'Не указана') :
              h('label', { className: 'mr-lead-persona-field' }, h('span', { className: 'mr-sr-only' }, `Личность лида: ${name}`), h(PersonaSelect, { personas, value: row.persona_id, className: `${s.select} mr-lead-persona-select`, onChange: persona => onPersonaChange(row.id, persona) }))),
            h('td', { className: 'mr-lead-status', 'data-label': 'Статус' },
              h('span', { className: statusClasses[row.status] || s.badge }, statusLabels[row.status] || row.status),
              h('div', { className: 'mr-lead-contact-time mr-dialog-muted' }, row.first_contact_at ? `Написали: ${date(row.first_contact_at)}` : 'Ещё не писали'),
              row.last_error && h('details', { className: 'mr-lead-error' }, h('summary', null, 'Подробнее об ошибке'), h('p', null, row.last_error))),
            h('td', { className: 'mr-dialog-actions mr-lead-actions' },
              canChat && h('button', { type: 'button', className: `${s.btnSm} mr-dialog-open`, 'aria-label': `Открыть диалог: ${name}`, onClick: () => onChat(row.telegram_user_id) }, 'Открыть', h('svg', { width: 14, height: 14, viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': true }, h('path', { d: 'M6 3.5 10.5 8 6 12.5', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round', strokeLinejoin: 'round' }))),
              ['pending', 'dead'].includes(row.status) && action(row.status === 'dead' ? 'Ещё раз' : 'В очередь', () => onQueue([row.id])),
              row.status === 'queued' && action('Снять', () => onUnqueue([row.id])),
              !row.first_contact_at && senderId && ['pending', 'queued', 'assigned', 'dead'].includes(row.status) && action('Написать с другого', () => onReassign(row), 'mr-lead-action', { title: `Отдать лид другому аккаунту — ${senderUsername ? `@${senderUsername}` : `#${senderId}`} его больше не возьмёт` }),
              action('Удалить', () => onDelete(row), 'mr-lead-delete')));
        }))));
}
