// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Страницы подменяем метками: тест проверяет только, куда ведёт адрес.
const page = (name) => ({ default: () => <div data-testid="page">{name}</div> });
vi.mock('./pages/Dashboard', () => page('dashboard'));
vi.mock('./pages/ConversationPage/ConversationPage', () => page('conversation'));
vi.mock('./pages/VoiceWork/VoiceWork', () => page('voice'));
vi.mock('./pages/Leads/Leads', () => page('leads'));
vi.mock('./pages/Accounts/Accounts', () => page('accounts'));
vi.mock('./pages/PhotoSets/PhotoSets', () => page('photo-sets'));
vi.mock('./pages/Buffer/Buffer', () => page('buffer'));
vi.mock('./pages/Managers/Managers', () => page('managers'));
vi.mock('./pages/Personas/Personas', () => page('personas'));
vi.mock('./pages/Stats/Stats', () => page('stats'));
vi.mock('./pages/Settings/Settings', () => page('general'));
vi.mock('./pages/Users/Users', () => page('leadget'));
vi.mock('./pages/Catalogs/Catalogs', () => page('catalogs'));
vi.mock('./components/Header/Header', () => ({ default: () => null }));

let role = 'admin';
vi.mock('./api/client', () => ({
  getToken: () => 'token',
  api: { get: vi.fn(async () => ({ id: 1, username: 'u', role })) },
}));

import App from './App';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
// jsdom не умеет прокрутку, а каркас прокручивает наверх при смене страницы.
window.scrollTo = () => {};
let host, root;
beforeEach(() => { host = document.createElement('div'); document.body.append(host); root = createRoot(host); });
afterEach(() => { act(() => root.unmount()); host.remove(); });

function Where() {
  return <span data-testid="path">{useLocation().pathname}</span>;
}

async function open(userRole, path) {
  role = userRole;
  await act(async () => root.render(<MemoryRouter key={`${userRole}:${path}`} initialEntries={[path]}><App key={`${userRole}:${path}`} /><Where /></MemoryRouter>));
  for (let i = 0; i < 5; i += 1) await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
  return {
    path: host.querySelector('[data-testid="path"]').textContent,
    page: host.querySelector('[data-testid="page"]')?.textContent ?? null,
  };
}

describe('маршруты меню', () => {
  it('админ: /settings открывает первую подвкладку, Аккаунты есть и сверху, и в Настройках', async () => {
    expect(await open('admin', '/settings')).toMatchObject({ path: '/settings/accounts', page: 'accounts' });
    expect(await open('admin', '/accounts')).toMatchObject({ path: '/accounts', page: 'accounts' });
    expect(await open('admin', '/settings/general')).toMatchObject({ page: 'general' });
  });

  it('старые адреса ведут в Настройки', async () => {
    expect(await open('admin', '/personas')).toMatchObject({ path: '/settings/personas', page: 'personas' });
    expect(await open('admin', '/users')).toMatchObject({ path: '/settings/leadget', page: 'leadget' });
    expect(await open('admin', '/catalogs')).toMatchObject({ path: '/settings/catalogs', page: 'catalogs' });
    expect(await open('head', '/buffer')).toMatchObject({ path: '/settings/buffer', page: 'buffer' });
    expect(await open('head', '/managers')).toMatchObject({ path: '/settings/team', page: 'managers' });
    expect(await open('teamlead', '/accounts')).toMatchObject({ path: '/settings/accounts', page: 'accounts' });
  });

  it('хед: Команда первой, статистики нет', async () => {
    expect(await open('head', '/settings')).toMatchObject({ path: '/settings/team', page: 'managers' });
    expect(await open('head', '/stats')).toMatchObject({ path: '/', page: 'dashboard' });
  });

  it('менеджер: Аккаунты и Образы сверху, Настроек нет', async () => {
    expect(await open('manager', '/photo-sets')).toMatchObject({ path: '/photo-sets', page: 'photo-sets' });
    expect(await open('manager', '/settings')).toMatchObject({ path: '/', page: 'dashboard' });
    expect(await open('manager', '/buffer')).toMatchObject({ path: '/', page: 'dashboard' });
  });

  it('тимлид не открывает Команду', async () => {
    expect(await open('teamlead', '/settings/team')).toMatchObject({ path: '/', page: 'dashboard' });
  });
});
