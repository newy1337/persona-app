// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React, { act } from 'react';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
import { createRoot } from 'react-dom/client';

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

// Статистика живёт в своём модуле: без этой подмены запрос падал, и страница
// в тестах оставалась без строк.
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
  await act(async () => root.render(React.createElement(Dashboard)));
  return { host, root };
}

describe('главная панель: один список вместо двух', () => {
  it('тяжёлый список запрашивается ровно один раз за загрузку', async () => {
    const { root } = await draw();
    expect(conversations).toHaveBeenCalledTimes(1);
    await act(async () => root.unmount());
  });

  it('живые берутся из того же списка: граница — сутки', async () => {
    const { host, root } = await draw();
    // Третья строка старше суток, значит в живых остаются две.
    expect(host.textContent).toContain('2');
    await act(async () => root.unmount());
  });

  it('шапка страницы — «Диалоги», фильтра по периоду больше нет', async () => {
    const { host, root } = await draw();
    expect(host.querySelector('h1').textContent).toBe('Диалоги');
    expect(host.textContent).not.toContain('Период');
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
