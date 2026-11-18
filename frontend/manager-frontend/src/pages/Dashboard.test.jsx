// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React, { act } from 'react';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
import { createRoot } from 'react-dom/client';
import { HeaderToolsContext } from '../components/AppLayout/headerTools';
import { fakeConversationPage } from '../test/fakeConversationPage';

const DAY = 24 * 3600;
const now = () => Math.floor(Date.now() / 1000);

const { live, page, queue, stats } = vi.hoisted(() => ({
  live: vi.fn(),
  page: vi.fn(),
  queue: vi.fn(),
  stats: vi.fn(),
}));

vi.mock('../api/conversations', () => ({
  getLiveConversations: live,
  getConversationPage: page,
  getNeedManagerAssist: queue,
  setConversationHidden: vi.fn(),
  setDealStage: vi.fn(),
  downloadChats: vi.fn(),
}));

// Плитки живут в своём модуле: без этой заглушки загрузка падала целиком и
// проверка живых диалогов проходила случайно, по цифре из другого места.
vi.mock('../api/stats', () => ({ getStats: stats }));

vi.mock('react-router-dom', async () => {
  const React = await import('react');
  return {
    Link: (props) => React.createElement('a', { href: props.to, className: props.className }, props.children),
    NavLink: (props) =>
      React.createElement('a', { href: props.to }, props.children),
    useNavigate: () => vi.fn(),
    useLocation: () => ({ pathname: '/' }),
  };
});

const row = (chatId, agoSeconds) => ({
  chat_id: chatId,
  last_message_ts: now() - agoSeconds,
  persona_id: 'nastya',
  pause_state: 'active',
  unread_count: 0,
});

let Dashboard;
// Страница отдаёт счётчик LIVE общей шапке через контекст — ловим его здесь.
const published = { tools: null };
function Shell({ children }) {
  return React.createElement(HeaderToolsContext.Provider, { value: { tools: published.tools, setTools: (t) => { published.tools = t; } } }, children);
}

beforeEach(async () => {
  sessionStorage.clear();
  // Активные за сутки сервер отдаёт все, без предела списка в тысячу.
  live.mockResolvedValue(Array.from({ length: 1185 }, (_, i) => row(i + 1, 60)));
  page.mockImplementation(fakeConversationPage([row(1, 60), row(2, 3 * 3600), row(3, DAY + 3600)]));
  queue.mockResolvedValue([]);
  stats.mockResolvedValue({ total: 3346, active_now: 1185, leads: 0, accounts: 1 });
  ({ default: Dashboard } = await import('./Dashboard'));
});

afterEach(() => vi.clearAllMocks());

async function draw() {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => root.render(React.createElement(Shell, null, React.createElement(Dashboard))));
  return { host, root };
}

describe('главная панель: показатели не упираются в предел списка', () => {
  it('за загрузку — одна страница таблицы и один список активных', async () => {
    const { root } = await draw();
    expect(page).toHaveBeenCalledTimes(1);
    expect(live).toHaveBeenCalledTimes(1);
    await act(async () => root.unmount());
  });

  it('LIVE — все активные за сутки с сервера и совпадает с плиткой «Активны сейчас»', async () => {
    const { host, root } = await draw();
    expect(published.tools?.liveCount).toBe(1185);
    expect(host.textContent).toContain('1185');
    await act(async () => root.unmount());
  });

  it('счётчик таблицы — все чаты, а не загруженная страница', async () => {
    const { host, root } = await draw();
    expect(host.querySelector('[data-testid="dialogs-total"]').textContent).toBe('ВСЕГО: 3');
    await act(async () => root.unmount());
  });
});
