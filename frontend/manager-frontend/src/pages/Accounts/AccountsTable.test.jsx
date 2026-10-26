// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { api } from '../../api/client';
import { AccountsTable, AccountsTableSkeleton } from './AccountsTable';
import { MeContext } from '../../components/AppLayout/me';

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

test('аккаунт не в сети — видна причина; в сети — нет; число чатов в строке', async () => {
  await render(
    <AccountsTable
      rows={[
        { id: 1, status: 'active', username: 'a1', chats: 37, offline_reason: 'прокси не отвечает (Socks5 timeout)' },
        { id: 2, status: 'active', username: 'a2', chats: 0, offline_reason: 'старая причина' },
      ]}
      alive={{ 1: false, 2: true }}
      helpers={helpers}
    />,
  );
  expect(rowOf(1).querySelector('[data-testid="offline-reason"]').textContent).toBe('прокси не отвечает (Socks5 timeout)');
  expect(rowOf(1).querySelector('[data-testid="account-chats"]').textContent).toBe('37');
  expect(rowOf(2).querySelector('[data-testid="offline-reason"]')).toBeNull();
});

test('VK-аккаунт: бейдж канала, ссылка на профиль VK, логин вместо телефона, «Новые куки»', async () => {
  const onLogin = vi.fn();
  await render(
    <AccountsTable
      rows={[
        { id: 5, channel: 'vk', login: 'vk@mail.ru', username: 'id123', status: 'active', chats: 1 },
        { id: 6, status: 'active', username: 'tg_user', phone_e164: '+70000000001' },
      ]}
      alive={{}}
      helpers={helpers}
      onLogin={onLogin}
    />,
  );
  // Колонка «Соцсеть» есть у каждой строки — и у Telegram, чтобы в «Все» было видно, где какой.
  expect(rowOf(5).querySelector('[data-testid="channel-cell"]').textContent).toBe('VK');
  expect(rowOf(6).querySelector('[data-testid="channel-cell"]').textContent).toBe('TG');
  expect(rowOf(5).querySelector('[data-testid="channel-badge"]')).toBeNull();
  expect(rowOf(5).querySelector('a').getAttribute('href')).toBe('https://vk.com/id123');
  expect(rowOf(6).querySelector('a').getAttribute('href')).toBe('https://t.me/tg_user');
  expect(rowOf(5).textContent).toContain('vk@mail.ru');
  await act(async () => byLabel('Подробнее', rowOf(5)).click());
  await act(async () => byText('Новые куки').click());
  expect(onLogin).toHaveBeenCalledWith(expect.objectContaining({ id: 5 }));
});

test('автоотправка фото: кнопка в раскрытии переключает, образ — в подробностях', async () => {
  const onPhotoAutoSend = vi.fn();
  await render(
    <AccountsTable
      rows={[{ id: 8, status: 'active', username: 'p1', photo_set_id: 3, photo_set_name: 'Осень', photo_auto_send: true }]}
      alive={{}}
      helpers={helpers}
      onPhotoAutoSend={onPhotoAutoSend}
    />,
  );
  await act(async () => byLabel('Подробнее').click());
  const facts = Object.fromEntries([...host.querySelectorAll('[role="region"] dl > div')].map((el) => [el.querySelector('dt').textContent, el.querySelector('dd').textContent]));
  expect(facts).toMatchObject({ Образ: 'Осень', 'Автоотправка фото': 'Разрешена' });
  await act(async () => byText('Выключить автофото').click());
  expect(onPhotoAutoSend).toHaveBeenCalledWith(expect.objectContaining({ id: 8 }), false);
});

test('хед видит «Менеджер» своей команды, менеджер — нет', async () => {
  const rows = [{ id: 9, status: 'active', username: 'h1', manager_username: 'anna', region_code: '0777' }];
  await render(<MeContext.Provider value={{ id: 1, role: 'head' }}><AccountsTable rows={rows} alive={{}} helpers={helpers} /></MeContext.Provider>);
  expect(host.querySelector('[data-testid="account-owner"]').textContent).toBe('anna');
  await render(<MeContext.Provider value={{ id: 2, role: 'manager' }}><AccountsTable rows={rows} alive={{}} helpers={helpers} /></MeContext.Provider>);
  expect(host.querySelector('[data-testid="account-owner"]')).toBeNull();
});

describe('проблемные аккаунты', () => {
  test('бан, нет сессии, включён но не в сети, ограничение, нет прокси — проблемы; пауза и выведенный — нет', async () => {
    const { accountProblems } = await import('./AccountsTable');
    const now = 1_800_000_000;
    expect(accountProblems({ status: 'active' }, true, now)).toEqual([]);
    expect(accountProblems({ status: 'paused' }, false, now)).toEqual([]);
    expect(accountProblems({ status: 'retired', needs_proxy_setup: true }, false, now)).toEqual([]);
    expect(accountProblems({ status: 'banned' }, false, now)).toEqual(['бан']);
    expect(accountProblems({ status: 'unauthorized' }, false, now)).toEqual(['нет сессии']);
    expect(accountProblems({ status: 'unauthorized', lost_at: 1, lost_reason: 'вышли с другого устройства' }, false, now)).toEqual(['сессия завершена: вышли с другого устройства']);
    expect(accountProblems({ status: 'active', offline_reason: 'прокси не отвечает' }, false, now)).toEqual(['не в сети: прокси не отвечает']);
    expect(accountProblems({ status: 'active', flood_until: now + 60, needs_proxy_setup: true }, true, now)).toEqual(['ограничен мессенджером', 'прокси не задан']);
  });
});
