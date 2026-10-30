// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, test } from 'vitest';
import { AccountsTable, DialogTable } from './ManagerRegion';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let host, root;
beforeEach(() => { host = document.createElement('div'); document.body.append(host); root = createRoot(host); });
afterEach(() => { act(() => root.unmount()); host.remove(); });

const helpers = { Avatar: () => null, statusLabel: (r) => r.status, statusClasses: {}, date: () => '—' };
const noop = () => {};

test('аккаунт не в сети — видна причина; число чатов — в строке', async () => {
  await act(async () => root.render(
    <AccountsTable
      rows={[
        { id: 1, status: 'active', username: 'a1', chats: 37, offline_reason: 'прокси не отвечает (Socks5 timeout)' },
        { id: 2, status: 'active', username: 'a2', chats: 0, offline_reason: null },
      ]}
      alive={{ 1: false, 2: true }}
      onEdit={noop} onLogin={noop} onProxy={noop} onStatus={noop} onClearFlood={noop} onDelete={noop}
      helpers={helpers}
    />,
  ));
  const first = host.querySelector('[data-account-id="1"]');
  expect(first.querySelector('[data-testid="offline-reason"]').textContent).toBe('прокси не отвечает (Socks5 timeout)');
  expect(first.querySelector('[data-testid="account-chats"]').textContent).toBe('Чатов: 37');
  const second = host.querySelector('[data-account-id="2"]');
  expect(second.querySelector('[data-testid="offline-reason"]')).toBeNull();
  expect(second.textContent).toContain('В сети');
});

test('в списке диалогов: точный ЧС и вероятный ЧС подписаны по-разному', async () => {
  const row = (chat_id, extra) => ({ chat_id, name: `Чат ${chat_id}`, last_message_ts: 1, ...extra });
  await act(async () => root.render(
    <DialogTable
      rows={[row(1, { blocked_by_client_at: 10 }), row(2, { likely_blocked_at: 20 })]}
      totalRows={2}
      onOpen={noop}
      onHide={noop}
      sort=""
      setSort={noop}
      helpers={{
        Avatar: () => null, Stage: () => null, isNew: () => false, unreadLabel: () => '',
        presence: () => '', nextAction: () => '', time: () => '', date: () => '',
        accountLost: () => '', typingLabels: {},
      }}
    />,
  ));
  const marks = [...host.querySelectorAll('[data-testid="blocked-mark"]')].map((m) => m.textContent);
  expect(marks).toEqual(['ЧС: заблокировал(а) нас', 'Вероятно, ЧС']);
});

test('ограниченный аккаунт — причина и срок прямо в строке', async () => {
  await act(async () => root.render(
    <AccountsTable
      rows={[{ id: 1, status: 'active', username: 'a1', flood_until: 2000, flood_reason: 'лимит импорта контактов: Telegram отложил номер +79001234567 (лид #11174)' }]}
      alive={{ 1: true }}
      onEdit={noop} onLogin={noop} onProxy={noop} onStatus={noop} onClearFlood={noop} onDelete={noop}
      helpers={{ ...helpers, date: () => '30.10 14:00' }}
    />,
  ));
  expect(host.querySelector('[data-testid="flood-reason"]').textContent).toBe('Ограничен: лимит импорта контактов: Telegram отложил номер +79001234567 (лид #11174) · до 30.10 14:00');
});
