import React from 'react';
import s from '../../styles/AdminPage.module.scss';
import { DEAL_STAGES, dealStageLabel } from '../../data/dealStages';
import { Attribution } from '../Attribution/Attribution';

const h = React.createElement;

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
