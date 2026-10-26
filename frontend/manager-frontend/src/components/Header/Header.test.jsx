// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { MeContext } from '../AppLayout/me';

vi.mock('./VoiceNotifications', () => ({ default: () => <span data-testid="notifications" /> }));
vi.mock('../../api/stats', () => ({ getStats: vi.fn(async () => ({ active_now: 0 })) }));

import Header from './Header';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let host, root;
beforeEach(() => { host = document.createElement('div'); document.body.append(host); root = createRoot(host); });
afterEach(() => { act(() => root.unmount()); host.remove(); });

const draw = (me) => act(async () => root.render(
  <MemoryRouter><MeContext.Provider value={me}><Header /></MeContext.Provider></MemoryRouter>,
));

test('уведомления видит менеджер, у админа их нет', async () => {
  await draw({ id: 2, username: 'm', role: 'manager' });
  expect(host.querySelector('[data-testid="notifications"]')).not.toBeNull();
  await draw({ id: 1, username: 'admin', role: 'admin' });
  expect(host.querySelector('[data-testid="notifications"]')).toBeNull();
});

test('наведение на «Настройки» раскрывает подвкладки своей роли, у менеджера пункта нет', async () => {
  const items = () => [...document.querySelectorAll('[role="menu"][aria-label="Разделы настроек"] [role="menuitem"]')].map((a) => a.textContent);
  const hover = async () => {
    const link = [...host.querySelectorAll('nav a')].find((a) => a.textContent.startsWith('Настройки'));
    await act(async () => link.dispatchEvent(new MouseEvent('mouseover', { bubbles: true })));
    return link;
  };
  await draw({ id: 6, username: 'boss', role: 'head' });
  const link = await hover();
  expect(link.getAttribute('href')).toBe('/settings');
  expect(items()).toEqual(['Команда', 'Буфер', 'Образы', 'Аккаунты', 'Шаблоны ответов']);
  await draw({ id: 1, username: 'admin', role: 'admin' });
  expect(items()).toEqual(['Аккаунты', 'Личности', 'Образы', 'LeadGet', 'Справочники', 'Буфер', 'Шаблоны ответов', 'Бот и API', 'Журнал']);
  await draw({ id: 2, username: 'm', role: 'manager' });
  expect([...host.querySelectorAll('nav a')].map((a) => a.textContent)).toEqual(['Диалоги', 'Лиды', 'Войсер', 'Аккаунты', 'Образы']);
});
