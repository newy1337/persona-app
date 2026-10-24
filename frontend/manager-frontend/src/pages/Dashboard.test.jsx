// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React, { act } from 'react';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
import { createRoot } from 'react-dom/client';
import { HeaderToolsContext } from '../components/AppLayout/headerTools';

const DAY = 24 * 3600;
const now = () => Math.floor(Date.now() / 1000);

const { conversations, queue, hidden, stats } = vi.hoisted(() => ({
  conversations: vi.fn(),
  queue: vi.fn(),
  hidden: vi.fn(),
  stats: vi.fn(),
}));

vi.mock('../api/conversations', () => ({
  getConversations: conversations,
  getNeedManagerAssist: queue,
  getHiddenConversations: hidden,
  getStats: stats,
  setConversationHidden: vi.fn(),
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
  conversations.mockResolvedValue([row(1, 60), row(2, 3 * 3600), row(3, DAY + 3600)]);
  queue.mockResolvedValue([]);
  hidden.mockResolvedValue([]);
  stats.mockResolvedValue({ total: 3, active_now: 2, leads: 0, accounts: 1 });
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

describe('главная панель: один список вместо двух', () => {
  it('тяжёлый список запрашивается ровно один раз за загрузку', async () => {
    const { root } = await draw();
    expect(conversations).toHaveBeenCalledTimes(1);
    await act(async () => root.unmount());
  });

  it('живые берутся из того же списка: граница — сутки', async () => {
    const { root } = await draw();
    // Третья строка старше суток, значит в живых остаются две.
    expect(published.tools?.liveCount).toBe(2);
    await act(async () => root.unmount());
  });

  it('«Ждут менеджера» — одна панель на всю ширину, «Активных диалогов» нет', async () => {
    queue.mockResolvedValue([{ chat_id: 7, name: 'Олег', queue_reason: 'hold_armed', waiting_since: now() - 600, is_paused: true }]);
    const { host, root } = await draw();
    const lists = host.querySelectorAll('[data-testid="agent-list"]');
    expect(lists.length).toBe(1);
    expect(lists[0].querySelectorAll('[data-testid="agent-card"]').length).toBe(1);
    const titles = [...host.querySelectorAll('h2')].map((h) => h.textContent);
    expect(titles).toContain('Ждут менеджера');
    expect(titles).not.toContain('Активные диалоги');
    await act(async () => root.unmount());
  });

  it('в архиве основной список тоже запрашивается: из него считаются живые диалоги', async () => {
    const { host, root } = await draw();
    conversations.mockClear();
    const button = [...host.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Архив');
    await act(async () => button.click());
    expect(hidden).toHaveBeenCalled();
    expect(conversations).toHaveBeenCalled();
    expect(published.tools?.liveCount).toBe(2);
    await act(async () => root.unmount());
  });

  it('шапка страницы — «Диалоги»; период меняет запрос плиток', async () => {
    window.sessionStorage.clear();
    const { host, root } = await draw();
    expect(host.querySelector('h1').textContent).toBe('Диалоги');
    expect(stats).toHaveBeenLastCalledWith({});
    const period = host.querySelector('select[aria-label="Период"]');
    await act(async () => {
      period.value = 'today';
      period.dispatchEvent(new Event('change', { bubbles: true }));
    });
    const [range] = stats.mock.calls.at(-1);
    expect(range.from).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(range.from).toBe(range.to);
    window.sessionStorage.clear();
    await act(async () => root.unmount());
  });

  it('поиск по имени подтягивает архив и показывает его строки', async () => {
    window.sessionStorage.setItem('panel_filters_dialogs', JSON.stringify({ who: 'Архивный' }));
    hidden.mockResolvedValue([{ ...row(9, 120), name: 'Архивный' }]);
    const { host, root } = await draw();
    expect(hidden).toHaveBeenCalled();
    expect(host.textContent).toContain('Архивный');
    window.sessionStorage.clear();
    await act(async () => root.unmount());
  });

  it('поиска, фильтров и «Новые на ручном» на странице пока нет', async () => {
    const { host, root } = await draw();
    expect(host.querySelector('[aria-label="Поиск по диалогам"]')).toBeNull();
    expect(host.querySelector('[data-testid="filter-new"]')).toBeNull();
    expect([...host.querySelectorAll('button')].some((b) => b.textContent.trim() === 'Фильтры')).toBe(false);
    await act(async () => root.unmount());
  });

  it('напоминание об этапах — строка в шапке таблицы, «Понятно» её убирает', async () => {
    window.localStorage.clear();
    const { host, root } = await draw();
    const hint = host.querySelector('[data-testid="stage-reminder"]');
    expect(hint.textContent).toContain('В 3 диалогах не указан этап');
    await act(async () => hint.querySelector('button[aria-label="Скрыть напоминание"]').click());
    expect(host.querySelector('[data-testid="stage-reminder"]')).toBeNull();
    await act(async () => root.unmount());
  });

  it('переключатель архива меняет заголовок и запрашивает архив', async () => {
    const { host, root } = await draw();
    const button = [...host.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Архив');
    await act(async () => button.click());
    expect(hidden).toHaveBeenCalled();
    expect(host.querySelector('h1').textContent).toBe('Архив');
    expect(host.textContent).toContain('Вернуться к диалогам');
    await act(async () => root.unmount());
  });
});
