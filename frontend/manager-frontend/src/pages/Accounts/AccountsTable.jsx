import React from 'react';
import s from '../../styles/AdminPage.module.scss';
import { PanelUX as ux } from '../../ui/PanelUX';

const h = React.createElement;
const { useState } = React;
const button = (text, onClick, props = {}) => h('button', { type: 'button', className: s.btnSm, onClick, ...props }, text);

export function AccountsTable({ rows, alive, onEdit, onLogin, onProxy, onStatus, onClearFlood, onDelete, helpers }) {
  const pending = ux.useActions().pending;
  const [expanded, setExpanded] = useState(null);
  const { Avatar, statusLabel, statusClasses, date } = helpers;
  const chevron = open => h('svg', { width: 12, height: 12, viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': true, style: { transform: open ? 'rotate(180deg)' : undefined } }, h('path', { d: 'm4 6 4 4 4-4', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round', strokeLinejoin: 'round' }));
  if (!rows.length) return h('p', { className: s.empty }, 'Аккаунтов нет. Добавьте номер, затем войдите — код придёт в Telegram.');
  return h('table', { className: 'mr-account-table', 'aria-label': 'Telegram-аккаунты' },
    h('thead', null, h('tr', null, ['Аккаунт', 'Личность / менеджер', 'Состояние', 'Действия'].map((label, index) => h('th', { key: label, scope: 'col', style: { width: ['30%', '28%', '17%', '25%'][index] } }, label)))),
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
      ];
      return h(React.Fragment, { key: row.id },
        h('tr', { className: `mr-account-row ${open ? 'mr-account-expanded' : ''}`, 'data-account-id': row.id },
          h('td', { className: 'mr-account-identity' },
            h('div', { className: 'mr-account-who' },
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
              h('span', { className: 'mr-account-region' }, row.region_code ? `Регион ${row.region_code}` : 'Регион не задан'))),
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
              !loginNeeded && row.status !== 'retired' && accountButton('Перелогин', () => onLogin(row)),
              row.flood_until && accountButton('Снять флуд', () => onClearFlood(row), { title: 'Аккаунт снова будет брать новых лидов' }),
              row.status !== 'retired' && row.status !== 'banned' && accountButton('Вывести', () => onStatus(row, 'retired')),
              accountButton('Удалить', () => onDelete(row), { className: s.btnSmDanger }))))));
    })));
}
