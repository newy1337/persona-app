// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { api } from '../../api/client';
import { AccountsTable, AccountsTableSkeleton } from './AccountsTable';

vi.mock('../../components/Header/Header', () => ({ default: () => null }));
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let host, root;
const users = { roles: ['admin', 'manager'], items: [
  { user_id: 1, username: 'admin', role: 'admin', account_ids: [] },
  { user_id: 2, username: 'manager_test', role: 'manager', region_code: '0077', account_ids: [7] },
] };
const accounts = [{ id: 7, username: 'sender_test', phone_e164: '+70000000000', status: 'active', persona_id: 'nastya', manager_username: 'manager_test', region_code: '0077' }];
const helpers = { Avatar: () => null, statusLabel: (a) => (a.status === 'paused' ? 'пауза' : 'активен'), statusClasses: {}, date: () => '—' };
beforeEach(() => {
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  vi.spyOn(api, 'get').mockImplementation(async path => path === '/api/managers' ? users : path === '/api/tg-accounts' ? accounts : path.endsWith('/credentials') ? {user_id:3,username:'new_manager',region_code:'0123',password:'synthetic-test-only'} : { user_id: 1, role: 'admin' });
});
afterEach(() => { act(() => root.unmount()); host.remove(); vi.restoreAllMocks(); });
const render = async element => act(async () => root.render(element));
const byLabel = (label, scope = host) => [...scope.querySelectorAll('button')].find(x => x.getAttribute('aria-label') === label);
const byText = (text, scope = host) => [...scope.querySelectorAll('button')].find(x => x.textContent === text);
const clickLabel = async label => act(async () => byLabel(label).click());
const rowOf = id => host.querySelector(`tr[data-account-id="${id}"]`);

test('account overview shows manager/region and keeps secondary actions collapsed', async () => {
  await render(<AccountsTable rows={accounts} alive={{}} helpers={helpers} />);
  expect(host.textContent).toContain('manager_test'); expect(host.textContent).toContain('0077');
  expect([...host.querySelectorAll('button')].some(b=>b.textContent==='Удалить')).toBe(false);
  await clickLabel('Подробнее');
  expect([...host.querySelectorAll('button')].some(b=>b.textContent==='Удалить')).toBe(true);
});

test('clicking the row toggles the expansion and aria-expanded', async () => {
  await render(<AccountsTable rows={accounts} alive={{}} helpers={helpers} />);
  expect(byLabel('Подробнее').getAttribute('aria-expanded')).toBe('false');
  expect(host.querySelector('[role="region"]')).toBeNull();

  await act(async () => rowOf(7).click());
  const chevron = byLabel('Свернуть');
  expect(chevron.getAttribute('aria-expanded')).toBe('true');
  const region = host.querySelector('[role="region"]');
  expect(region.id).toBe(chevron.getAttribute('aria-controls'));
  for (const text of ['Прокси', 'Перелогин', 'Вывести', 'Удалить']) expect(byText(text, region)).toBeTruthy();
  for (const label of ['ID аккаунта', 'Диалогов', 'Прокси', 'Назначение', 'Регион', 'Последний вход', 'Пульс', 'Лимит сообщений в день']) {
    expect([...region.querySelectorAll('dt')].some(dt => dt.textContent === label)).toBe(true);
  }

  await act(async () => rowOf(7).click());
  expect(byLabel('Подробнее').getAttribute('aria-expanded')).toBe('false');
  expect(host.querySelector('[role="region"]')).toBeNull();
});

test('row actions do not toggle the expansion; several rows stay open across a re-render', async () => {
  const onEdit = vi.fn(); const onStatus = vi.fn();
  const rows = [accounts[0], { ...accounts[0], id: 8, username: 'second_test', phone_e164: '+70000000001', status: 'paused' }];
  const table = list => <AccountsTable rows={list} alive={{ 7: true }} onEdit={onEdit} onStatus={onStatus} helpers={helpers} />;
  await render(table(rows));

  await act(async () => byLabel('Изменить', rowOf(7)).click());
  await act(async () => byLabel('Пауза', rowOf(7)).click());
  await act(async () => byLabel('Включить', rowOf(8)).click());
  await act(async () => rowOf(7).querySelector('a').click());
  expect(onEdit).toHaveBeenCalledWith(rows[0]);
  expect(onStatus).toHaveBeenNthCalledWith(1, rows[0], 'paused');
  expect(onStatus).toHaveBeenNthCalledWith(2, rows[1], 'active');
  expect(host.querySelectorAll('[role="region"]').length).toBe(0);

  await act(async () => rowOf(7).click());
  await act(async () => byLabel('Подробнее', rowOf(8)).click());
  expect(host.querySelectorAll('[role="region"]').length).toBe(2);

  // Опрос приносит новый массив с теми же id — раскрытые строки остаются раскрытыми.
  await render(table(rows.map(r => ({ ...r }))));
  expect(host.querySelectorAll('[role="region"]').length).toBe(2);

  expect(rowOf(7).querySelector('[role="img"]').getAttribute('aria-label')).toBe('В сети');
  expect(rowOf(8).querySelector('[role="img"]').getAttribute('aria-label')).toBe('Не в сети');
});

test('empty state and the first-load skeleton live inside the table block', async () => {
  await render(<AccountsTable rows={[]} alive={{}} helpers={helpers} />);
  expect(host.querySelector('table td').textContent).toContain('Аккаунтов нет');
  await render(<AccountsTableSkeleton rows={2} />);
  expect(host.querySelectorAll('[role="status"] tbody tr').length).toBe(2);
  expect(host.querySelectorAll('[role="status"] tbody tr:first-child td').length).toBe(host.querySelectorAll('[role="status"] thead th').length);
});
